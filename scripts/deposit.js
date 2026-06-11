// scripts/deposit.js  — run ONCE after deploying the vault
import { parseEther, formatEther } from "viem";
import { walletClient, publicClient } from "./config.js";
import { abiOf } from "./helpers.js";
import { addresses } from "./addresses.js";

const DEPOSIT_AMOUNT = parseEther("5000");

async function main() {
  const vaultAbi = await abiOf("TradingVault");
  const tokenAbi = await abiOf("TestToken");
  const V = addresses.vault;

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

  const bal = await publicClient.readContract({
    address: addresses.mUSD, abi: tokenAbi,
    functionName: "balanceOf", args: [V],
  });
  console.log(`  Done. Vault mUSD balance: ${formatEther(bal)}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });