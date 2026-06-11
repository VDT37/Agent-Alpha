// scripts/trigger.js — fire the pipeline and walk all callbacks; run as often as you like.
// Polls for the vault's events instead of fixed sleeps, so slow agent calls don't
// cause premature empty reads.
import { parseEther, formatEther } from "viem";
import { walletClient, publicClient } from "./config.js";
import { abiOf, waitForEvents, getEventsChunked } from "./helpers.js";
import { addresses } from "./addresses.js";

const PRICE_FEE = parseEther("0.12");
const fmtPct = (fp) => `${(Number(fp) / 1e16).toFixed(2)}%`;

async function main() {
  const vaultAbi = await abiOf("TradingVault");
  const tokenAbi = await abiOf("TestToken");
  const V = addresses.vault;

  // Pre-flight: fuel + that a deposit exists to trade with
  const fuel = await publicClient.getBalance({ address: V });
  const musd = await publicClient.readContract({
    address: addresses.mUSD, abi: tokenAbi, functionName: "balanceOf", args: [V],
  });
  const vetoEnabled = await publicClient.readContract({
    address: V, abi: vaultAbi, functionName: "vetoEnabled",
  });
  const loopCost = vetoEnabled ? "0.81" : "0.57";
  console.log(`Vault fuel: ${formatEther(fuel)} STT | Vault mUSD: ${formatEther(musd)} | veto: ${vetoEnabled ? "on" : "off"}`);
  if (fuel < parseEther(vetoEnabled ? "0.9" : "0.6")) {
    console.log(`!! Low fuel — run fundVault.js (need ~${loopCost} STT/loop).`);
  }
  if (musd === 0n) console.log("!! Vault has no mUSD — run deposit.js first, or it can't trade.");

  // Fire the chain
  console.log("\ncheckAndTrade: requesting BTC price...");
  const hash = await walletClient.writeContract({
    address: V, abi: vaultAbi, functionName: "checkAndTrade", args: [], value: PRICE_FEE,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const fromBlock = receipt.blockNumber;
  console.log("  Sent.\n");

  const skippedReason = (hits) =>
    hits.find((h) => h.eventName === "DecisionSkipped")?.args?.reason;

  // [1/4] price
  console.log("[1/4] Waiting for PRICE callback...");
  let hits = await waitForEvents(V, vaultAbi, ["PriceChecked"], fromBlock, 90_000);
  if (hits.length === 0) return console.log("  No price callback within 90s — try readState.js later.");
  const price = hits[0].args.price;
  console.log(`  Price: ${Number(price) / 1e8} USD`);

  // [2/4] news (3-page search can be slow — give it 150s)
  console.log("[2/4] Waiting for NEWS callback...");
  hits = await waitForEvents(V, vaultAbi, ["NewsAnalyzed", "DecisionSkipped"], fromBlock, 150_000);
  if (hits.length === 0) return console.log("  No news callback within 150s — try readState.js later.");
  if (!hits.some((h) => h.eventName === "NewsAnalyzed")) {
    return console.log(`  Skipped: ${skippedReason(hits)}`);
  }
  const sentiment = hits.find((h) => h.eventName === "NewsAnalyzed").args.sentiment;
  console.log(`  Sentiment: ${sentiment}`);

  // [3/4] conviction + sizing (DecisionMade/VetoRequested land in the same tx)
  console.log("[3/4] Waiting for CONVICTION callback...");
  hits = await waitForEvents(V, vaultAbi, ["ConvictionScored"], fromBlock, 120_000);
  if (hits.length === 0) return console.log("  No conviction callback within 120s — try readState.js later.");
  const conviction = hits.find((h) => h.eventName === "ConvictionScored").args.conviction;

  const [volFP, fractionFP, decision] = await Promise.all([
    publicClient.readContract({ address: V, abi: vaultAbi, functionName: "lastVolFP" }),
    publicClient.readContract({ address: V, abi: vaultAbi, functionName: "lastTradeFractionFP" }),
    publicClient.readContract({ address: V, abi: vaultAbi, functionName: "lastDecision" }),
  ]);
  console.log(`  Conviction: ${conviction}/100 | vol: ${fmtPct(volFP)} | sized fraction: ${fmtPct(fractionFP)} | decision: ${decision}`);

  // [4/4] outcome: direct trade, or risk-officer verdict
  let traded = null;
  let vetoed = false;
  const allNow = await getEventsChunked(V, vaultAbi, fromBlock, await publicClient.getBlockNumber());
  if (decision === "buy") {
    if (allNow.some((h) => h.eventName === "SizedTradeExecuted")) {
      traded = allNow.find((h) => h.eventName === "SizedTradeExecuted").args;
    } else if (allNow.some((h) => h.eventName === "VetoRequested")) {
      console.log("[4/4] Waiting for RISK-VETO verdict...");
      hits = await waitForEvents(
        V, vaultAbi, ["SizedTradeExecuted", "TradeVetoed", "DecisionSkipped"], fromBlock, 120_000
      );
      const trade = hits.find((h) => h.eventName === "SizedTradeExecuted");
      if (trade) traded = trade.args;
      else if (hits.some((h) => h.eventName === "TradeVetoed")) vetoed = true;
      else console.log(`  ${hits.length ? `Skipped: ${skippedReason(hits)}` : "No verdict within 120s — try readState.js later."}`);
    } else {
      console.log("  (buy decided but no trade/veto event — check fuel and readState.js)");
    }
  }

  const [meth, musdAfter] = await Promise.all([
    publicClient.readContract({ address: addresses.mETH, abi: tokenAbi, functionName: "balanceOf", args: [V] }),
    publicClient.readContract({ address: addresses.mUSD, abi: tokenAbi, functionName: "balanceOf", args: [V] }),
  ]);

  console.log("\n=== REASONING TRAIL (all consensus-verified, permanently on-chain) ===");
  console.log(`  Price:      ${Number(price) / 1e8} USD`);
  console.log(`  Sentiment:  ${sentiment}`);
  console.log(`  Conviction: ${conviction}/100`);
  console.log(`  Volatility: ${fmtPct(volFP)} per update (mean abs return)`);
  console.log(`  Sized at:   ${fmtPct(fractionFP)} of capital`);
  if (traded) console.log(`  TRADE:      spent ${formatEther(traded.amountIn)} mUSD → received ${formatEther(traded.amountOut)} mETH`);
  if (vetoed) console.log(`  VETOED:     risk officer rejected the sized trade`);
  if (decision === "hold") console.log(`  HOLD:       conviction below floor / fraction zero — no trade`);
  console.log("=== VAULT STATE ===");
  console.log(`  mUSD: ${formatEther(musdAfter)} | mETH: ${formatEther(meth)} | fuel: ${formatEther(await publicClient.getBalance({ address: V }))} STT`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
