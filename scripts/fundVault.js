// scripts/fundVault.js
import { parseEther } from "viem";
import { walletClient, publicClient } from "./config.js";
import { addresses } from "./addresses.js";

async function main() {
  // Send 2 STT to the vault — covers ~5 full loops (0.36 STT each) with buffer.
  const hash = await walletClient.sendTransaction({
    to: addresses.vault,
    value: parseEther("2"),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("Vault funded with 2 STT. Hash:", hash);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });