// Deploys the vault, wired to the platform, both tokens, the AMM, and a max-trade cap. 
// The cap (maxTradeStable) is one of your guardrails
// I've set it to 1,000 mUSD per trade, so a single decision can never spend more than that.

// To test the live behavior after deployment:
// 1. Set the initial price (seed the AMM)
// 2. Deposit your own mUSD into the vault
// 3. Ask the agent to check the price (this will trigger a state update)
// 4. Watch the vault execute a trade automatically if the price moved enough

// scripts/deployVault.js
import { parseEther } from "viem";
import { publicClient } from "./config.js";
import { deploy } from "./helpers.js";
import { addresses } from "./addresses.js";

const MAX_TRADE_STABLE = parseEther("1000"); // cap: 1000 mUSD per single trade

async function main() {
  for (const k of ["platform", "mUSD", "mETH", "amm"]) {
    if (!addresses[k]) throw new Error(`Fill in ${k} in addresses.js first.`);
  }

  console.log("Deploying TradingVault...");
  // Constructor: (platform, stable, risky, amm, maxTradeStable)
  const vault = await deploy("TradingVault", [
    addresses.platform,
    addresses.mUSD,
    addresses.mETH,
    addresses.amm,
    MAX_TRADE_STABLE,
  ]);

  const block = await publicClient.getBlockNumber();
  console.log("\n=== PASTE THIS INTO scripts/addresses.js ===");
  console.log(`  vault: "${vault}",`);
  console.log(`  vaultDeployBlock: ${block},`);
  console.log("\nThen re-run fundVault.js and deposit.js — a fresh vault carries nothing over.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });