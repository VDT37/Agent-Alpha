// scripts/auditTrail.js — independent verification of the vault's reasoning history.
//
// Anyone — not just the operator — can run this against the vault address and get
// the identical, tamper-proof record of every price read, sentiment, conviction
// score, sizing computation, veto verdict and trade. The events are append-only
// on-chain logs; each agent result behind them was consensus-verified by Somnia
// validators before being recorded.
//
// Scan start: addresses.vaultDeployBlock, or $env:AUDIT_FROM_BLOCK to override.
import { formatEther } from "viem";
import { publicClient } from "./config.js";
import { abiOf, getEventsChunked } from "./helpers.js";
import { addresses } from "./addresses.js";

const fmtPct = (fp) => `${(Number(fp) / 1e16).toFixed(2)}%`;

async function main() {
  const vaultAbi = await abiOf("TradingVault");
  const V = addresses.vault;

  const latest = await publicClient.getBlockNumber();
  const fromBlock = process.env.AUDIT_FROM_BLOCK
    ? BigInt(process.env.AUDIT_FROM_BLOCK)
    : addresses.vaultDeployBlock !== undefined
      ? BigInt(addresses.vaultDeployBlock)
      : latest > 100_000n ? latest - 100_000n : 0n;

  console.log(`Auditing vault ${V}`);
  console.log(`Scanning blocks ${fromBlock} → ${latest}...\n`);

  // Somnia's RPC caps eth_getLogs at 1000 blocks/request — scan in chunks.
  let lastPct = -1;
  const logs = await getEventsChunked(V, vaultAbi, fromBlock, latest, (done, total) => {
    const pct = Number(((done - fromBlock) * 100n) / (total - fromBlock + 1n));
    if (pct >= lastPct + 20) { process.stdout.write(`  ...scanned ${pct}%\r`); lastPct = pct; }
  });
  if (logs.length === 0) return console.log("No events found in this range.");

  // timestamps, one lookup per unique block
  const stamps = new Map();
  for (const blockNumber of new Set(logs.map((l) => l.blockNumber))) {
    const block = await publicClient.getBlock({ blockNumber });
    stamps.set(blockNumber, new Date(Number(block.timestamp) * 1000).toISOString().replace("T", " ").slice(0, 19));
  }

  const describe = (l) => {
    const a = l.args;
    switch (l.eventName) {
      case "PriceChecked":       return `PRICE       BTC $${(Number(a.price) / 1e8).toLocaleString()}`;
      case "NewsAnalyzed":       return `NEWS        sentiment: ${a.sentiment}`;
      case "ConvictionScored":   return `CONVICTION  ${a.conviction}/100`;
      case "DecisionMade":       return `DECISION    ${a.decision}`;
      case "VetoRequested":      return `VETO ASK    risk officer reviewing trade sized at ${fmtPct(a.fractionFP)} of capital`;
      case "TradeVetoed":        return `VETOED      risk officer rejected trade sized at ${fmtPct(a.fractionFP)}`;
      case "SizedTradeExecuted": return `TRADE       conviction ${a.conviction} · vol ${fmtPct(a.volFP)} · sized ${fmtPct(a.fractionFP)} → spent ${formatEther(a.amountIn)} mUSD, got ${formatEther(a.amountOut)} mETH`;
      case "TradeExecuted":      return `TRADE       (${a.decision}) spent ${formatEther(a.amountIn ?? 0n)}`;
      case "DecisionSkipped":    return `SKIPPED     ${a.reason}`;
      case "ScenarioSet":        return `SCENARIO    ${a.scenario || "(cleared)"}`;
      case "Paused":             return `PAUSED      ${a.status}`;
      default:                   return l.eventName;
    }
  };

  logs.sort((x, y) =>
    x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : Number(x.blockNumber - y.blockNumber)
  );
  for (const l of logs) {
    console.log(`${stamps.get(l.blockNumber)}  ${describe(l)}`);
    console.log(`${" ".repeat(21)}tx ${l.transactionHash}`);
  }

  console.log(`\n${logs.length} events. Verify any tx at https://shannon-explorer.somnia.network/`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
