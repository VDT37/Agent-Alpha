// scripts/testConviction.js — standalone proof that inferNumber returns a clean int 0-100.
// Run this BEFORE trusting the conviction call inside the vault (same rule as testNews).
import { parseEther } from "viem";
import { walletClient, publicClient } from "./config.js";
import { deploy, abiOf, waitForEvents } from "./helpers.js";
import { addresses } from "./addresses.js";

const LLM_FEE = parseEther("0.24"); // floor 0.03 + 0.07 × 3 validators

// Edit freely between runs — no redeploy needed.
const TEST_PROMPT =
  "You are a disciplined crypto trading strategy. BTC price is 60000 USD. " +
  "News sentiment is: bullish. Output a single integer 0-100 representing your " +
  "conviction to BUY BTC now (0 = no conviction / avoid, 100 = maximum conviction). " +
  "Be decisive and respond to the market context.";

// Paste the deployed address here after the first run to skip redeploys.
let cachedAddress = "0x5f23d3dbe3e932adb736c78f591bdb56ad7924c9";

async function main() {
  const abi = await abiOf("ConvictionOracle");

  const ORACLE = cachedAddress || (await deploy("ConvictionOracle", [addresses.platform]));
  if (!cachedAddress) console.log(`\n  → paste into cachedAddress for re-runs: "${ORACLE}"`);

  console.log("\nFunding oracle for the call...");
  let hash = await walletClient.sendTransaction({ to: ORACLE, value: parseEther("0.3") });
  await publicClient.waitForTransactionReceipt({ hash });

  console.log("Requesting conviction score...");
  hash = await walletClient.writeContract({
    address: ORACLE, abi, functionName: "requestConviction",
    args: [TEST_PROMPT], value: LLM_FEE,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("  Request sent. Polling for callback (up to 90s)...");

  const hits = await waitForEvents(
    ORACLE, abi, ["ConvictionReceived", "RequestFailed"], receipt.blockNumber
  );

  const conviction = await publicClient.readContract({ address: ORACLE, abi, functionName: "lastConviction" });
  const status = await publicClient.readContract({ address: ORACLE, abi, functionName: "lastStatus" });
  const statusName = ["NONE (no callback yet)", "SUCCESS", "FAILED", "TIMED OUT"][status];

  console.log(`\n=== RESULT ===`);
  console.log(`  Oracle:     ${ORACLE}`);
  console.log(`  Status:     ${statusName}`);
  console.log(`  Conviction: ${conviction}`);

  if (status === 1 && conviction >= 0n && conviction <= 100n) {
    console.log(`\n  ✓ inferNumber returns a clean integer in range. Safe to use in the vault.`);
  } else if (hits.length === 0) {
    console.log(`\n  No callback within 90s — re-run readState-style checks or try again.`);
  } else {
    console.log(`\n  Agent ${statusName}. Inspect the prompt/params before wiring into the vault.`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
