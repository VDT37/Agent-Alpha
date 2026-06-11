"use client";

import { useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { addresses, vaultAbi, EXPLORER, fmtPct, fmtToken } from "../lib/contracts";

type FeedItem = {
  key: string;
  blockNumber: bigint;
  logIndex: number;
  time?: string;
  kind: "trade" | "veto" | "skip" | "brain" | "info";
  text: string;
  tx: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describe(log: any): { kind: FeedItem["kind"]; text: string } {
  const a = log.args ?? {};
  switch (log.eventName) {
    case "PriceChecked":
      return { kind: "info", text: `BTC price read: $${(Number(a.price) / 1e8).toLocaleString()} (consensus-verified JSON API agent)` };
    case "NewsAnalyzed":
      return { kind: "brain", text: `News sentiment: ${a.sentiment} (LLM Parse Website agent, CoinDesk search)` };
    case "ConvictionScored":
      return { kind: "brain", text: `AI conviction to buy: ${a.conviction}/100 (LLM inferNumber)` };
    case "DecisionMade":
      return { kind: "brain", text: `Decision: ${a.decision}` };
    case "VetoRequested":
      return { kind: "brain", text: `Risk officer reviewing trade sized at ${fmtPct(a.fractionFP)} of capital (2nd LLM agent)` };
    case "TradeVetoed":
      return { kind: "veto", text: `VETOED — risk officer rejected the trade sized at ${fmtPct(a.fractionFP)}` };
    case "SizedTradeExecuted":
      return {
        kind: "trade",
        text: `TRADE — conviction ${a.conviction} · vol ${fmtPct(a.volFP)} · sized ${fmtPct(a.fractionFP)} → spent ${fmtToken(a.amountIn)} mUSD, received ${fmtToken(a.amountOut, 4)} mETH`,
      };
    case "DecisionSkipped":
      return { kind: "skip", text: `Skipped: ${a.reason}` };
    case "ScenarioSet":
      return { kind: "info", text: a.scenario ? `Scenario set: “${a.scenario}”` : "Scenario cleared (live news only)" };
    case "Paused":
      return { kind: "skip", text: a.status ? "Circuit breaker: PAUSED" : "Circuit breaker: resumed" };
    default:
      return { kind: "info", text: log.eventName };
  }
}

export function ReasoningFeed() {
  const client = usePublicClient();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [status, setStatus] = useState("loading history…");
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!client) return;
    let cancelled = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ingest = async (logs: any[]) => {
      const fresh = logs.filter((l) => {
        const key = `${l.transactionHash}-${l.logIndex}`;
        if (seen.current.has(key)) return false;
        seen.current.add(key);
        return true;
      });
      if (fresh.length === 0) return;

      const stamps = new Map<bigint, string>();
      for (const bn of new Set(fresh.map((l) => l.blockNumber as bigint))) {
        try {
          const block = await client.getBlock({ blockNumber: bn });
          stamps.set(bn, new Date(Number(block.timestamp) * 1000).toLocaleString());
        } catch { /* timestamp is cosmetic */ }
      }

      const mapped: FeedItem[] = fresh.map((l) => ({
        key: `${l.transactionHash}-${l.logIndex}`,
        blockNumber: l.blockNumber,
        logIndex: l.logIndex,
        time: stamps.get(l.blockNumber),
        tx: l.transactionHash,
        ...describe(l),
      }));

      if (!cancelled) {
        setItems((prev) =>
          [...mapped, ...prev].sort((x, y) =>
            x.blockNumber === y.blockNumber
              ? y.logIndex - x.logIndex
              : Number(y.blockNumber - x.blockNumber)
          )
        );
      }
    };

    (async () => {
      try {
        // Somnia's RPC caps eth_getLogs at 1000 blocks/request, so scan in
        // chunks, newest first, back to the deploy block (or ~30k blocks max).
        const CHUNK = 1000n;
        const latest = await client.getBlockNumber();
        const floor =
          addresses.vaultDeployBlock !== undefined
            ? BigInt(addresses.vaultDeployBlock)
            : latest > 30_000n ? latest - 30_000n : 0n;
        const lowest = latest - 30_000n > floor ? latest - 30_000n : floor;

        for (let end = latest; end >= lowest && !cancelled; end -= CHUNK) {
          const start = end - CHUNK + 1n > lowest ? end - CHUNK + 1n : lowest;
          const logs = await client.getContractEvents({
            address: addresses.vault, abi: vaultAbi, fromBlock: start, toBlock: end,
          });
          await ingest(logs);
          if (start === lowest) break;
        }
        if (!cancelled) setStatus("");
      } catch (e) {
        if (!cancelled) setStatus(`history load failed: ${(e as Error).message.split("\n")[0]}`);
      }
    })();

    const unwatch = client.watchContractEvent({
      address: addresses.vault,
      abi: vaultAbi,
      onLogs: ingest,
      pollingInterval: 5_000,
    });
    return () => { cancelled = true; unwatch(); };
  }, [client]);

  return (
    <div className="panel">
      <h2>Live reasoning trail</h2>
      {status && <div className="note warn">{status}</div>}
      <div className="feed">
        {items.length === 0 && !status && (
          <div className="note">No events yet — fire a loop with scripts/trigger.js.</div>
        )}
        {items.map((it) => (
          <div key={it.key} className={`feed-item ${it.kind}`}>
            <span className="time">{it.time ?? `#${it.blockNumber}`}</span>
            <span className="what">{it.text}</span>
            <a href={`${EXPLORER}/tx/${it.tx}`} target="_blank" rel="noreferrer">verify tx ↗</a>
          </div>
        ))}
      </div>
      <div className="note">
        Every row is an append-only on-chain event; the agent result behind it was
        consensus-verified by Somnia validators before the vault acted on it. Anyone can
        reproduce this exact feed with <span className="mono">scripts/auditTrail.js</span> — the
        strategy cannot lie about what it read or why it traded.
      </div>
    </div>
  );
}
