// scripts/fundVault.js
import { parseEther } from "viem";
import { walletClient, publicClient } from "./config.js";
import { addresses } from "./addresses.js";

async function main() {
  // Send 5 STT to the vault — covers all loops (~0.57 STT each) with buffer.
  const hash = await walletClient.sendTransaction({
    to: addresses.vault,
    value: parseEther("5"),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("Vault funded with 5 STT. Hash:", hash);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });