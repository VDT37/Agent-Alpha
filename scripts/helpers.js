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