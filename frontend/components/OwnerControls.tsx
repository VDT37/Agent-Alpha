"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { addresses, vaultAbi, fmtToken, fmtPct } from "../lib/contracts";

export function OwnerControls() {
  const { address, isConnected } = useAccount();
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash });

  const vault = addresses.vault;
  const opts = { query: { refetchInterval: 8000 } } as const;

  const { data: owner } = useReadContract({ address: vault, abi: vaultAbi, functionName: "owner" });
  const { data: paused } = useReadContract({ address: vault, abi: vaultAbi, functionName: "paused", ...opts });
  const { data: vetoEnabled } = useReadContract({ address: vault, abi: vaultAbi, functionName: "vetoEnabled", ...opts });
  const { data: maxTrade } = useReadContract({ address: vault, abi: vaultAbi, functionName: "maxTradeStable", ...opts });
  const { data: targetVol } = useReadContract({ address: vault, abi: vaultAbi, functionName: "targetVolFP", ...opts });
  const { data: minConviction } = useReadContract({ address: vault, abi: vaultAbi, functionName: "minConviction", ...opts });
  const { data: scenario } = useReadContract({ address: vault, abi: vaultAbi, functionName: "scenario", ...opts });

  const isOwner =
    isConnected && !!owner && !!address &&
    (owner as string).toLowerCase() === address.toLowerCase();

  const [maxTradeIn, setMaxTradeIn] = useState("");
  const [targetVolIn, setTargetVolIn] = useState("");
  const [minConvIn, setMinConvIn] = useState("");
  const [scenarioIn, setScenarioIn] = useState("");

  const write = (functionName: string, args: unknown[]) =>
    writeContract({ address: vault, abi: vaultAbi, functionName, args });

  return (
    <div className="panel">
      <h2>Guardrails (owner)</h2>

      <div className="stats">
        <div className="stat"><div className="label">circuit breaker</div><div className="value">{paused ? "PAUSED" : "live"}</div></div>
        <div className="stat"><div className="label">risk veto</div><div className="value">{vetoEnabled === undefined ? "—" : vetoEnabled ? "on" : "off"}</div></div>
        <div className="stat"><div className="label">max trade</div><div className="value">{fmtToken(maxTrade as bigint)} mUSD</div></div>
        <div className="stat"><div className="label">target vol</div><div className="value">{fmtPct(targetVol as bigint)}</div></div>
        <div className="stat"><div className="label">min conviction</div><div className="value">{minConviction !== undefined ? `${minConviction}/100` : "—"}</div></div>
        <div className="stat"><div className="label">scenario</div><div className="value" style={{ fontSize: 12 }}>{(scenario as string) || "live news only"}</div></div>
      </div>

      <div className="row">
        <button className={paused ? "" : "danger"} disabled={!isOwner || isPending}
          onClick={() => write("setPaused", [!paused])}>
          {paused ? "Unpause" : "Pause"}
        </button>
        <button className="secondary" disabled={!isOwner || isPending}
          onClick={() => write("setVetoEnabled", [!vetoEnabled])}>
          {vetoEnabled ? "Disable veto" : "Enable veto"}
        </button>
      </div>

      <div className="row">
        <label>max trade (mUSD)</label>
        <input type="number" value={maxTradeIn} onChange={(e) => setMaxTradeIn(e.target.value)} placeholder="1000" />
        <button className="secondary" disabled={!isOwner || isPending || !maxTradeIn}
          onClick={() => write("setMaxTrade", [parseEther(maxTradeIn)])}>Set</button>
      </div>

      <div className="row">
        <label>target vol (%)</label>
        <input type="number" value={targetVolIn} onChange={(e) => setTargetVolIn(e.target.value)} placeholder="1.0" step="0.1" />
        <button className="secondary" disabled={!isOwner || isPending || !targetVolIn}
          onClick={() => write("setTargetVol", [BigInt(Math.round(parseFloat(targetVolIn) * 1e16))])}>Set</button>
      </div>

      <div className="row">
        <label>min conviction</label>
        <input type="number" value={minConvIn} onChange={(e) => setMinConvIn(e.target.value)} placeholder="55" min="0" max="100" />
        <button className="secondary" disabled={!isOwner || isPending || !minConvIn}
          onClick={() => write("setMinConviction", [BigInt(minConvIn)])}>Set</button>
      </div>

      <div className="row">
        <label>scenario</label>
        <input type="text" value={scenarioIn} onChange={(e) => setScenarioIn(e.target.value)}
          placeholder="owner-injected market context (empty = live news only)" />
        <button className="secondary" disabled={!isOwner || isPending}
          onClick={() => write("setScenario", [scenarioIn])}>Set</button>
      </div>

      {(isPending || confirming) && <div className="note warn">transaction pending…</div>}
      {error && <div className="note" style={{ color: "var(--red)" }}>{error.message.split("\n")[0]}</div>}
      {!isOwner && (
        <div className="note">
          Connect with the vault owner wallet to operate the controls. Current owner:{" "}
          <span className="mono">{(owner as string) ?? "—"}</span>
        </div>
      )}
    </div>
  );
}
