// scripts/helpers.js
import hre from "hardhat";
import { walletClient, publicClient } from "./config.js";

// Deploys a compiled contract by name, with constructor args, and returns its address.
export async function deploy(contractName, args = []) {
  const artifact = await hre.artifacts.readArtifact(contractName);

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });

  console.log(`  ${contractName} deploy tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ${contractName} deployed at: ${receipt.contractAddress}`);
  return receipt.contractAddress;
}

// Loads a contract's ABI so we can read/write it.
export async function abiOf(contractName) {
  const artifact = await hre.artifacts.readArtifact(contractName);
  return artifact.abi;
}

// Somnia's RPC caps eth_getLogs at 1000 blocks per request (and Shannon mints
// >1 block/sec), so every history scan must be chunked.
export async function getEventsChunked(address, abi, fromBlock, toBlock, onProgress) {
  const CHUNK = 1000n;
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK) {
    const end = start + CHUNK - 1n > toBlock ? toBlock : start + CHUNK - 1n;
    logs.push(...(await publicClient.getContractEvents({ address, abi, fromBlock: start, toBlock: end })));
    if (onProgress) onProgress(end, toBlock);
  }
  return logs;
}

// Polls the chain for contract events instead of sleeping a fixed time.
// Returns the matching logs as soon as any appear, or [] on timeout.
export async function waitForEvents(address, abi, names, fromBlock, timeoutMs = 90_000, pollMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const latest = await publicClient.getBlockNumber();
    const logs = await getEventsChunked(address, abi, fromBlock, latest);
    const hits = logs.filter((l) => names.includes(l.eventName));
    if (hits.length > 0) return hits;
    if (Date.now() >= deadline) return [];
    await new Promise((r) => setTimeout(r, pollMs));
  }
}