// scripts/readState.js — read-only snapshot, costs nothing
import { formatEther } from "viem";
import { publicClient } from "./config.js";
import { abiOf } from "./helpers.js";
import { addresses } from "./addresses.js";

const fmtPct = (fp) => `${(Number(fp) / 1e16).toFixed(2)}%`;

async function main() {
  const vaultAbi = await abiOf("TradingVault");
  const tokenAbi = await abiOf("TestToken");
  const V = addresses.vault;

  const read = (functionName) =>
    publicClient.readContract({ address: V, abi: vaultAbi, functionName });

  const [
    price, sentiment, decision, fuel, musd, meth,
    conviction, lastVolFP, fractionFP, currentVolFP, historyLen,
    targetVolFP, minConviction, vetoEnabled, scenario, paused, maxTrade,
  ] = await Promise.all([
    read("lastPrice"),
    read("lastSentiment"),
    read("lastDecision"),
    publicClient.getBalance({ address: V }),
    publicClient.readContract({ address: addresses.mUSD, abi: tokenAbi, functionName: "balanceOf", args: [V] }),
    publicClient.readContract({ address: addresses.mETH, abi: tokenAbi, functionName: "balanceOf", args: [V] }),
    read("lastConviction"),
    read("lastVolFP"),
    read("lastTradeFractionFP"),
    read("computeVolFP"),
    read("priceHistoryLength"),
    read("targetVolFP"),
    read("minConviction"),
    read("vetoEnabled"),
    read("scenario"),
    read("paused"),
    read("maxTradeStable"),
  ]);

  console.log("=== VAULT SNAPSHOT ===");
  console.log(`  Price:        ${Number(price) / 1e8} USD  (history: ${historyLen} points)`);
  console.log(`  Sentiment:    ${sentiment || "(none)"}`);
  console.log(`  Conviction:   ${conviction}/100`);
  console.log(`  Decision:     ${decision || "(none)"}`);
  console.log("=== SIZING ===");
  console.log(`  Current vol:  ${fmtPct(currentVolFP)} per update | target: ${fmtPct(targetVolFP)}`);
  console.log(`  Last sizing:  vol ${fmtPct(lastVolFP)} → fraction ${fmtPct(fractionFP)} of capital`);
  console.log(`  Floors/caps:  minConviction ${minConviction} | maxTrade ${formatEther(maxTrade)} mUSD`);
  console.log("=== CONTROLS ===");
  console.log(`  Risk veto:    ${vetoEnabled ? "enabled" : "disabled"} | paused: ${paused}`);
  console.log(`  Scenario:     ${scenario || "(none — live news only)"}`);
  console.log("=== BALANCES ===");
  console.log(`  Fuel:         ${formatEther(fuel)} STT`);
  console.log(`  mUSD:         ${formatEther(musd)}`);
  console.log(`  mETH:         ${formatEther(meth)}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
