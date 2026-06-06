// It deposits mUSD into the vault, triggers checkAndTrade twice 
// (because your rule needs a previous price to compare against 
// the first call just records a baseline), and reads the resulting state.

// scripts/runVault.js
import { parseEther, formatEther } from "viem";
import { walletClient, publicClient, account } from "./config.js";
import { abiOf } from "./helpers.js";
import { addresses } from "./addresses.js";

const PRICE_FEE = parseEther("0.12");  // for checkAndTrade → JSON API call
const DEPOSIT_AMOUNT = parseEther("5000");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const vaultAbi = await abiOf("TradingVault");
  const tokenAbi = await abiOf("TestToken");
  const V = addresses.vault;

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

  // --- 2. Trigger checkAndTrade (attaches 0.12 STT for the price call) ---
  const currentScenario = await publicClient.readContract({
  address: V, abi: vaultAbi, functionName: "scenario",
});
console.log("Active scenario:", currentScenario || "(none — neutral prompt)");
  
  console.log("checkAndTrade: requesting BTC price from JSON API agent...");
  hash = await walletClient.writeContract({
    address: V, abi: vaultAbi,
    functionName: "checkAndTrade", args: [], value: PRICE_FEE,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  Price request sent. Waiting ~25s for price callback...");
  await sleep(25000);

  // --- 3. Read price — confirms first callback fired ---
  const lastPrice = await publicClient.readContract({
    address: V, abi: vaultAbi, functionName: "lastPrice",
  });
  console.log(`  Price received: ${Number(lastPrice) / 1e8} USD`);
  console.log("  LLM decision request now in flight. Waiting ~25s for decision callback...");
  await sleep(25000);

  // --- 4. Read final state — both callbacks should have fired ---
  const lastDecision = await publicClient.readContract({
    address: V, abi: vaultAbi, functionName: "lastDecision",
  });
  const vaultMeth = await publicClient.readContract({
    address: addresses.mETH, abi: tokenAbi,
    functionName: "balanceOf", args: [V],
  });
  const vaultMusd = await publicClient.readContract({
    address: addresses.mUSD, abi: tokenAbi,
    functionName: "balanceOf", args: [V],
  });

  console.log("\n=== VAULT STATE (Phase C) ===");
  console.log(`  lastPrice:     ${Number(lastPrice) / 1e8} USD`);
  console.log(`  lastDecision:  ${lastDecision || "(empty — decision callback not yet fired)"}`);
  console.log(`  vault mUSD:    ${formatEther(vaultMusd)}`);
  console.log(`  vault mETH:    ${formatEther(vaultMeth)}`);

  if (lastDecision === "buy" && vaultMeth > 0n) {
    console.log("\n  ✓ AI decided BUY and the vault traded. Full two-agent pipeline working.");
  } else if (lastDecision === "hold" || lastDecision === "sell") {
    console.log(`\n  ✓ AI decided ${lastDecision.toUpperCase()}. No trade — correct behaviour.`);
    console.log("    The two-agent pipeline worked; the model just chose conservatively.");
    console.log("    Run scripts/setScenario.js to inject a crash context and demo a buy.");
  } else {
    console.log("\n  Decision callback may still be in flight. Wait 10s and run scripts/readState.js");
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });