import hre from "hardhat";
import { getContract, parseEther } from "viem";
import { walletClient, publicClient } from "./config.js";

const ORACLE_ADDRESS = "0xdb65b11fa6bf1943acac1e31a82752e4d4d20934";

const artifact = await hre.artifacts.readArtifact("BtcPriceOracle");

const oracle = getContract({
  address: ORACLE_ADDRESS,
  abi: artifact.abi,
  client: { public: publicClient, wallet: walletClient },
});

console.log("Sending price request...");
const hash = await oracle.write.requestBitcoinPrice({ value: parseEther("0.12") });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log("Request sent. Tx hash:", receipt.transactionHash);
console.log("Now wait ~10-30s, then run scripts/read.js to see the price.");
