// scripts/withdraw.js — withdraw your full mUSD deposit from a vault.
// Defaults to addresses.vault; override with $env:VAULT to recover funds from an
// OLD vault instance before/after a redeploy.
import { formatEther } from "viem";
import { account, walletClient, publicClient } from "./config.js";
import { abiOf } from "./helpers.js";
import { addresses } from "./addresses.js";

async function main() {
  const vaultAbi = await abiOf("TradingVault");
  const V = process.env.VAULT || addresses.vault;

  const deposited = await publicClient.readContract({
    address: V, abi: vaultAbi, functionName: "deposits", args: [account.address],
  });
  console.log(`Vault ${V}\n  your recorded deposit: ${formatEther(deposited)} mUSD`);
  if (deposited === 0n) return console.log("  Nothing to withdraw.");

  const hash = await walletClient.writeContract({
    address: V, abi: vaultAbi, functionName: "withdraw", args: [deposited],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  Withdrawn ${formatEther(deposited)} mUSD. Hash: ${hash}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
