// scripts/runVault.js  (Phase D — price → news → decision)
import { parseEther, formatEther } from "viem";
import { walletClient, publicClient, account } from "./config.js";
import { abiOf } from "./helpers.js";
import { addresses } from "./addresses.js";

const PRICE_FEE = parseEther("0.12");      // attached for checkAndTrade → JSON API call
const DEPOSIT_AMOUNT = parseEther("5000"); // mUSD deposited into the vault
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const vaultAbi = await abiOf("TradingVault");
  const tokenAbi = await abiOf("TestToken");
  const V = addresses.vault;

  // --- 0. Pre-flight: show vault fuel so we don't run on empty ---
  const fuel = await publicClient.getBalance({ address: V });
  console.log(`Vault STT fuel: ${formatEther(fuel)} STT`);
  if (fuel < parseEther("0.6")) {
    console.log("!! Low fuel. A full loop needs ~0.57 STT (news + decision). Run fundVault.js first.\n");
  }

  // --- 1. Deposit mUSD (approve → deposit) ---
  console.log("Approving vault to pull mUSD...");
  let hash = await walletClient.writeContract({
    address: addresses.mUSD, abi: tokenAbi,
    functionName: "approve", args: [V, DEPOSIT_AMOUNT],
  });
  await publicClient.waitForTransactionReceipt({ hash });

  console.log("Depositing 5000 mUSD...");
  hash = await walletClient.writeContract({
    address: V, abi: vaultAbi,
    functionName: "deposit", args: [DEPOSIT_AMOUNT],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  Deposited.\n");

  // --- 2. Trigger the chain (attaches 0.12 STT for the price call) ---
  console.log("checkAndTrade: requesting BTC price from JSON API agent...");
  hash = await walletClient.writeContract({
    address: V, abi: vaultAbi,
    functionName: "checkAndTrade", args: [], value: PRICE_FEE,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  Price request sent.\n");

  // --- 3. Wait for callback 1: price ---
  console.log("Waiting ~25s for PRICE callback...");
  await sleep(25000);
  const lastPrice = await publicClient.readContract({
    address: V, abi: vaultAbi, functionName: "lastPrice",
  });
  console.log(`  [1/3] Price received: ${Number(lastPrice) / 1e8} USD`);
  if (lastPrice === 0n) {
    console.log("  !! Price is 0 — price callback reverted (often low vault fuel). Check fundVault.js.");
  }

  // --- 4. Wait for callback 2: news sentiment ---
  console.log("Waiting ~25s for NEWS callback (Parse Website agent)...");
  await sleep(25000);
  const lastSentiment = await publicClient.readContract({
    address: V, abi: vaultAbi, functionName: "lastSentiment",
  });
  console.log(`  [2/3] Sentiment read: ${lastSentiment || "(empty — news callback not yet fired)"}`);

  // --- 5. Wait for callback 3: decision ---
  console.log("Waiting ~25s for DECISION callback (LLM Inference agent)...");
  await sleep(25000);
  const lastDecision = await publicClient.readContract({
    address: V, abi: vaultAbi, functionName: "lastDecision",
  });

  // --- 6. Final state ---
  const vaultMeth = await publicClient.readContract({
    address: addresses.mETH, abi: tokenAbi,
    functionName: "balanceOf", args: [V],
  });
  const vaultMusd = await publicClient.readContract({
    address: addresses.mUSD, abi: tokenAbi,
    functionName: "balanceOf", args: [V],
  });

  console.log("\n=== REASONING TRAIL (Phase D) ===");
  console.log(`  Price:      ${Number(lastPrice) / 1e8} USD`);
  console.log(`  Sentiment:  ${lastSentiment || "(none)"}`);
  console.log(`  Decision:   ${lastDecision || "(none)"}`);
  console.log("\n=== VAULT STATE ===");
  console.log(`  vault mUSD: ${formatEther(vaultMusd)}`);
  console.log(`  vault mETH: ${formatEther(vaultMeth)}`);

  if (lastDecision === "buy" && vaultMeth > 0n) {
    console.log("\n  ✓ Full three-agent pipeline fired: price → news → decision → trade.");
  } else if (lastDecision === "hold" || lastDecision === "sell") {
    console.log(`\n  ✓ Pipeline fired end-to-end. AI read '${lastSentiment}' sentiment and chose ${lastDecision.toUpperCase()}.`);
  } else if (lastSentiment && !lastDecision) {
    console.log("\n  News landed but decision didn't — decision callback may be slow, or vault fuel ran out mid-chain.");
  } else if (!lastSentiment) {
    console.log("\n  News callback didn't fire. Most likely: the scraped URL failed/timed out, or low vault fuel.");
    console.log("  Check the URL in _onNews, or try a more scrape-friendly page.");
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });