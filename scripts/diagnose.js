// scripts/diagnose.js
import { formatEther } from "viem";
import { publicClient } from "./config.js";
import { abiOf } from "./helpers.js";
import { addresses } from "./addresses.js";

async function main() {
  const vaultAbi = await abiOf("TradingVault");

  // Check vault's STT balance (needed for the LLM call from inside the callback)
  const sttBalance = await publicClient.getBalance({ address: addresses.vault });
  console.log("Vault STT balance:", formatEther(sttBalance), "STT");

  // Check lastPrice and lastDecision
  const lastPrice = await publicClient.readContract({
    address: addresses.vault, abi: vaultAbi, functionName: "lastPrice",
  });
  const lastDecision = await publicClient.readContract({
    address: addresses.vault, abi: vaultAbi, functionName: "lastDecision",
  });
  const paused = await publicClient.readContract({
    address: addresses.vault, abi: vaultAbi, functionName: "paused",
  });

  console.log("lastPrice:    ", lastPrice.toString());
  console.log("lastDecision: ", lastDecision || "(empty)");
  console.log("paused:       ", paused);

  // Verify bytecode exists (confirms it's really the new contract)
  const code = await publicClient.getCode({ address: addresses.vault });
  console.log("Bytecode length:", code?.length ?? 0, "chars");
  console.log("addresses.vault:", addresses.vault);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });