"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { VaultPanel } from "../components/VaultPanel";
import { OwnerControls } from "../components/OwnerControls";
import { ReasoningFeed } from "../components/ReasoningFeed";
import { addresses, EXPLORER } from "../lib/contracts";

export default function Home() {
  return (
    <main className="container">
      <div className="header">
        <h1>Autonomous Trading Vault</h1>
        <ConnectButton showBalance={false} />
      </div>
      <p className="tagline">
        A strategy whose entire reasoning is consensus-verified and permanently recorded
        on-chain. It cannot lie about what data it read or why it traded.{" "}
        <a
          className="mono"
          style={{ color: "var(--muted)" }}
          href={`${EXPLORER}/address/${addresses.vault}`}
          target="_blank"
          rel="noreferrer"
        >
          vault ↗
        </a>
      </p>

      <div className="grid">
        <VaultPanel />
        <OwnerControls />
      </div>

      <div style={{ marginTop: 16 }}>
        <ReasoningFeed />
      </div>
    </main>
  );
}
