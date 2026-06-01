// scripts/deployTokens.js
// Deploys your two test tokens and mints yourself a generous supply of each. 
// The minting is so you have funds to both seed the AMM and deposit into the vault.

import { parseEther } from "viem";
import { walletClient, publicClient, account } from "./config.js";
import { deploy, abiOf } from "./helpers.js";

async function main() {
  console.log("Deploying test tokens...");

  // TestToken constructor takes (name, symbol)
  const mUSD = await deploy("TestToken", ["Mock USD", "mUSD"]);
  const mETH = await deploy("TestToken", ["Mock ETH", "mETH"]);

  // Mint yourself a big supply of each (1,000,000 of each, 18 decimals).
  const tokenAbi = await abiOf("TestToken");
  const supply = parseEther("1000000");

  for (const [label, addr] of [["mUSD", mUSD], ["mETH", mETH]]) {
    const hash = await walletClient.writeContract({
      address: addr,
      abi: tokenAbi,
      functionName: "mint",
      args: [account.address, supply],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  Minted 1,000,000 ${label} to ${account.address}`);
  }

  console.log("\n=== PASTE THESE INTO scripts/addresses.js ===");
  console.log(`  mUSD: "${mUSD}",`);
  console.log(`  mETH: "${mETH}",`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });