"use client";

import { useState } from "react";
import { parseEther } from "viem";
import {
  useAccount, useBalance, useReadContract, useWriteContract, useWaitForTransactionReceipt,
} from "wagmi";
import { addresses, vaultAbi, tokenAbi, fmtToken, fmtPrice, fmtPct } from "../lib/contracts";

export function VaultPanel() {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("100");
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash });

  const opts = { query: { refetchInterval: 8000 } } as const;
  const vault = addresses.vault;

  const { data: musd } = useReadContract({
    address: addresses.mUSD, abi: tokenAbi, functionName: "balanceOf", args: [vault], ...opts,
  });
  const { data: meth } = useReadContract({
    address: addresses.mETH, abi: tokenAbi, functionName: "balanceOf", args: [vault], ...opts,
  });
  const { data: fuel } = useBalance({ address: vault, ...opts });
  const { data: myDeposit } = useReadContract({
    address: vault, abi: vaultAbi, functionName: "deposits",
    args: [address ?? "0x0000000000000000000000000000000000000000"], ...opts,
  });
  const { data: price } = useReadContract({ address: vault, abi: vaultAbi, functionName: "lastPrice", ...opts });
  const { data: sentiment } = useReadContract({ address: vault, abi: vaultAbi, functionName: "lastSentiment", ...opts });
  const { data: conviction } = useReadContract({ address: vault, abi: vaultAbi, functionName: "lastConviction", ...opts });
  const { data: volFP } = useReadContract({ address: vault, abi: vaultAbi, functionName: "computeVolFP", ...opts });

  const wei = () => {
    try { return parseEther(amount || "0"); } catch { return 0n; }
  };

  const approve = () =>
    writeContract({ address: addresses.mUSD, abi: tokenAbi, functionName: "approve", args: [vault, wei()] });
  const deposit = () =>
    writeContract({ address: vault, abi: vaultAbi, functionName: "deposit", args: [wei()] });
  const withdraw = () =>
    writeContract({ address: vault, abi: vaultAbi, functionName: "withdraw", args: [wei()] });

  return (
    <div className="panel">
      <h2>Vault</h2>
      <div className="stats">
        <div className="stat"><div className="label">mUSD capital</div><div className="value">{fmtToken(musd as bigint)}</div></div>
        <div className="stat"><div className="label">mETH held</div><div className="value">{fmtToken(meth as bigint, 4)}</div></div>
        <div className="stat"><div className="label">STT fuel</div><div className="value">{fuel ? fmtToken(fuel.value) : "—"}</div></div>
        <div className="stat"><div className="label">last BTC price</div><div className="value">{fmtPrice(price as bigint)}</div></div>
        <div className="stat"><div className="label">sentiment</div><div className="value">{(sentiment as string) || "—"}</div></div>
        <div className="stat"><div className="label">conviction / vol</div><div className="value">{conviction !== undefined ? `${conviction}` : "—"} · {fmtPct(volFP as bigint)}</div></div>
      </div>

      <div className="row">
        <label>your deposit</label>
        <span className="mono">{fmtToken(myDeposit as bigint)} mUSD</span>
      </div>
      <div className="row">
        <label>amount (mUSD)</label>
        <input type="number" value={amount} min="0" onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="row">
        <button className="secondary" disabled={!isConnected || isPending} onClick={approve}>1. Approve</button>
        <button disabled={!isConnected || isPending} onClick={deposit}>2. Deposit</button>
        <button className="secondary" disabled={!isConnected || isPending} onClick={withdraw}>Withdraw</button>
      </div>

      {(isPending || confirming) && <div className="note warn">transaction pending…</div>}
      {error && <div className="note" style={{ color: "var(--red)" }}>{error.message.split("\n")[0]}</div>}
      <div className="note">
        Deposits are mUSD trading capital. STT fuel (what the vault spends to pay agent
        validators) is funded separately by the operator. Withdrawals are limited to your
        recorded deposit — see README for the flat-accounting limitation.
      </div>
    </div>
  );
}
