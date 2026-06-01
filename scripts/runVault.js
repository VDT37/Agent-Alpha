// It deposits mUSD into the vault, triggers checkAndTrade twice 
// (because your rule needs a previous price to compare against 
// the first call just records a baseline), and reads the resulting state.

// DUMB RULE:
// Trades only if the price dropped since the last check. 
// On the very first call, lastPrice is 0, so it just stores the baseline and does nothing. 
// The second call has something to compare against. In a live BTC market the price won't reliably drop between two calls seconds apart, 
// so this script also includes an optional forceState helper note at the end for demoing the trade deterministically.

// scripts/runVault.js

import { parseEther, formatEther } from "viem";
import { walletClient, publicClient, account } from "./config.js";
import { abiOf } from "./helpers.js";
import { addresses } from "./addresses.js";

const DEPOSIT_AMOUNT = parseEther("5000");   // deposit 5000 mUSD into the vault
const AGENT_FEE = parseEther("0.12");        // STT attached to pay the JSON API agent

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const vaultAbi = await abiOf("TradingVault");
  const tokenAbi = await abiOf("TestToken");
  const ammAbi = await abiOf("SimpleAMM");
  const V = addresses.vault;

  // --- 1. Deposit mUSD into the vault (approve -> deposit) ---
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
  console.log("  Deposited.");

  // --- 2. First checkAndTrade: sets the baseline price (no trade yet) ---
  console.log("\ncheckAndTrade #1 (baseline)...");
  hash = await walletClient.writeContract({
    address: V, abi: vaultAbi,
    functionName: "checkAndTrade", args: [], value: AGENT_FEE,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  Request sent. Waiting ~25s for the agent callback...");
  await sleep(25000);

  let lastPrice = await publicClient.readContract({
    address: V, abi: vaultAbi, functionName: "lastPrice",
  });
  console.log(`  lastPrice now: ${Number(lastPrice) / 1e8} USD`);

  // --- 3. Second checkAndTrade: compares to baseline, may trade ---
  console.log("\ncheckAndTrade #2 (decision)...");
  hash = await walletClient.writeContract({
    address: V, abi: vaultAbi,
    functionName: "checkAndTrade", args: [], value: AGENT_FEE,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  Request sent. Waiting ~25s for the agent callback...");
  await sleep(25000);

  // --- 4. Read the result: did the vault acquire any mETH? ---
  const vaultMeth = await publicClient.readContract({
    address: addresses.mETH, abi: tokenAbi,
    functionName: "balanceOf", args: [V],
  });
  const vaultMusd = await publicClient.readContract({
    address: addresses.mUSD, abi: tokenAbi,
    functionName: "balanceOf", args: [V],
  });
  lastPrice = await publicClient.readContract({
    address: V, abi: vaultAbi, functionName: "lastPrice",
  });

  console.log("\n=== VAULT STATE ===");
  console.log(`  lastPrice:    ${Number(lastPrice) / 1e8} USD`);
  console.log(`  vault mUSD:   ${formatEther(vaultMusd)}`);
  console.log(`  vault mETH:   ${formatEther(vaultMeth)}`);
  if (vaultMeth > 0n) {
    console.log("  -> The vault traded! It bought mETH on the dip.");
  } else {
    console.log("  -> No trade (price didn't drop between checks). This is expected behaviour, not a bug.");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });