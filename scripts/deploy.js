import hre from "hardhat";
import { walletClient, publicClient } from "./config.js";

const PLATFORM_ADDRESS = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";

const artifact = await hre.artifacts.readArtifact("BtcPriceOracle");

const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [PLATFORM_ADDRESS],
});

console.log("Deploy tx hash:", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log("BtcPriceOracle deployed to:", receipt.contractAddress);
