import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Autonomous Trading Vault — Somnia Shannon",
  description:
    "On-chain multi-agent trading vault whose entire reasoning is consensus-verified and permanently recorded on-chain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
