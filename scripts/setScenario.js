// scripts/setScenario.js
import { walletClient, publicClient } from "./config.js";
import { abiOf } from "./helpers.js";
import { addresses } from "./addresses.js";

// Change this string to control what context the AI sees.
// Try: "BTC just crashed 20% in the last hour, fear index is extreme"
// Or:  "" to clear it back to neutral
const SCENARIO = "BTC crashed 30% in an hour, this is a generational buying opportunity, fear index at all-time low";

async function main() {
  const vaultAbi = await abiOf("TradingVault");
  const hash = await walletClient.writeContract({
    address: addresses.vault, abi: vaultAbi,
    functionName: "setScenario", args: [SCENARIO],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("Scenario set:", SCENARIO || "(cleared)");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });