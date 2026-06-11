"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, getDefaultConfig, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { somniaShannon } from "../lib/chain";

// WalletConnect projectId only matters for the WC QR connector; injected wallets
// (MetaMask) work with the placeholder. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable WC.
const config = getDefaultConfig({
  appName: "Autonomous Trading Vault",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "SOMNIA_VAULT_DEMO",
  chains: [somniaShannon],
  ssr: true,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: "#6c5ce7" })}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
