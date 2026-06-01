// Deploys the AMM for the mUSD/mETH pair, then seeds it with liquidity.
// The amounts you seed set the starting price.

// I'm seeding 20,000 mUSD + 10 mETH, which sets a starting price of 2,000 mUSD per mETH. 
// That's a deliberately deep pool relative to the trade sizes, 
// so the demo trades execute near the quoted price instead of swinging wildly

// scripts/deployAmm.js
import { parseEther } from "viem";
import { walletClient, publicClient, account } from "./config.js";
import { deploy, abiOf } from "./helpers.js";
import { addresses } from "./addresses.js";

// Starting price = mUSD amount / mETH amount = 20000 / 10 = 2000 mUSD per mETH
const SEED_MUSD = parseEther("20000");
const SEED_METH = parseEther("10");

async function main() {
  if (!addresses.mUSD || !addresses.mETH) {
    throw new Error("Fill in mUSD and mETH in addresses.js first.");
  }

  console.log("Deploying SimpleAMM...");
  // Constructor is (token0, token1). token0 = stable (mUSD), token1 = risky (mETH).
  const amm = await deploy("SimpleAMM", [addresses.mUSD, addresses.mETH]);

  const tokenAbi = await abiOf("TestToken");
  const ammAbi = await abiOf("SimpleAMM");

  // STEP 1 (approve): let the AMM pull our tokens. Remember: approve THEN act.
  for (const [label, addr, amount] of [
    ["mUSD", addresses.mUSD, SEED_MUSD],
    ["mETH", addresses.mETH, SEED_METH],
  ]) {
    const hash = await walletClient.writeContract({
      address: addr,
      abi: tokenAbi,
      functionName: "approve",
      args: [amm, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  Approved AMM to pull ${label}`);
  }

  // STEP 2 (act): add the liquidity. This is what sets the starting price.
  const hash = await walletClient.writeContract({
    address: amm,
    abi: ammAbi,
    functionName: "addLiquidity",
    args: [SEED_MUSD, SEED_METH],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  Liquidity added: 20,000 mUSD + 10 mETH (price = 2000 mUSD/mETH)");

  console.log("\n=== PASTE THIS INTO scripts/addresses.js ===");
  console.log(`  amm: "${amm}",`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });