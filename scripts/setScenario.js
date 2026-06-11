// scripts/setScenario.js — owner-set market context injected into the conviction prompt.
// The AI still reasons; you only control its inputs (honest demo determinism).
//
//   $env:SCENARIO = "A major ETF approval was just announced; institutions are buying aggressively."
//   npx hardhat run scripts/setScenario.js --network somnia
//
// Clear it with:  $env:SCENARIO = "clear"
import { walletClient, publicClient } from "./config.js";
import { abiOf } from "./helpers.js";
import { addresses } from "./addresses.js";

const DEFAULT_SCENARIO =
  "Markets are rallying strongly after better-than-expected macro data; " +
  "institutional inflows into BTC are at a 6-month high.";

async function main() {
  const vaultAbi = await abiOf("TradingVault");
  const raw = process.env.SCENARIO ?? DEFAULT_SCENARIO;
  const scenario = raw === "clear" ? "" : raw;

  console.log(scenario ? `Setting scenario:\n  "${scenario}"` : "Clearing scenario (live news only).");
  const hash = await walletClient.writeContract({
    address: addresses.vault, abi: vaultAbi, functionName: "setScenario", args: [scenario],
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const onChain = await publicClient.readContract({
    address: addresses.vault, abi: vaultAbi, functionName: "scenario",
  });
  console.log(`Done. On-chain scenario: ${onChain || "(none)"}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
