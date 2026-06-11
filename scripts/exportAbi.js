// scripts/exportAbi.js — copy contract ABIs + addresses into frontend/lib/generated.json
// Plain node script (no hardhat session needed):  node scripts/exportAbi.js
// Re-run after every compile or addresses.js change.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { addresses } from "./addresses.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const abiOf = (name) =>
  JSON.parse(
    readFileSync(path.join(root, "artifacts", "contracts", `${name}.sol`, `${name}.json`), "utf8")
  ).abi;

const out = {
  addresses,
  vaultAbi: abiOf("TradingVault"),
  tokenAbi: abiOf("TestToken"),
  ammAbi: abiOf("SimpleAMM"),
};

const dest = path.join(root, "frontend", "lib", "generated.json");
mkdirSync(path.dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`Wrote ${dest}`);
