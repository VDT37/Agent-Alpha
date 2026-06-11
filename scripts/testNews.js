// scripts/testNews.js
import { parseEther } from "viem";
import { walletClient, publicClient } from "./config.js";
import { deploy, abiOf } from "./helpers.js";
import { addresses } from "./addresses.js";

// Try different URLs here. Re-run with a new one each time — no redeploy needed.
const TEST_URL = "https://cointelegraph.com/";

const PARSE_FEE = parseEther("0.33"); // from the Explorer
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cachedAddress = "0x5174119e9a9079410a797b3c874a6005d8786a3e"; // set after first deploy so re-runs reuse it

async function main() {
  const abi = await abiOf("NewsOracle");

  // Deploy once; on subsequent runs, paste the address below to skip redeploy.
  const ORACLE = cachedAddress || await deploy("NewsOracle", [addresses.platform]);

  console.log(`\nFunding oracle for the call...`);
  let hash = await walletClient.sendTransaction({ to: ORACLE, value: parseEther("0.5") });
  await publicClient.waitForTransactionReceipt({ hash });

  console.log(`Requesting sentiment from: ${TEST_URL}`);
  hash = await walletClient.writeContract({
    address: ORACLE, abi, functionName: "requestSentiment",
    args: [TEST_URL], value: PARSE_FEE,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  Request sent. Waiting ~30s for callback...");
  await sleep(30000);

  const sentiment = await publicClient.readContract({ address: ORACLE, abi, functionName: "lastSentiment" });
  const status = await publicClient.readContract({ address: ORACLE, abi, functionName: "lastStatus" });

  const statusName = ["NONE (no callback yet)", "SUCCESS", "FAILED", "TIMED OUT"][status];
  console.log(`\n=== RESULT ===`);
  console.log(`  Oracle:    ${ORACLE}`);
  console.log(`  Status:    ${statusName}`);
  console.log(`  Sentiment: ${sentiment || "(empty)"}`);

  if (status === 1) console.log(`\n  ✓ This URL WORKS. Use it in the vault's _onNews.`);
  else if (status === 0) console.log(`\n  No callback yet — wait 15s and re-read, or the request never resolved.`);
  else console.log(`\n  Agent ${statusName} on this URL. Try a different, lighter site.`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });