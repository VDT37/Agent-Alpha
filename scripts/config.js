import "dotenv/config";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const somniaChain = {
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [process.env.SOMNIA_RPC_URL] } },
};

const rawKey = process.env.PRIVATE_KEY;
export const account = privateKeyToAccount(rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`);

export const publicClient = createPublicClient({
  chain: somniaChain,
  transport: http(process.env.SOMNIA_RPC_URL),
});

export const walletClient = createWalletClient({
  account,
  chain: somniaChain,
  transport: http(process.env.SOMNIA_RPC_URL),
});
