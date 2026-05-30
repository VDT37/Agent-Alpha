import hre from "hardhat";
import { getContract } from "viem";
import { publicClient } from "./config.js";

const ORACLE_ADDRESS = "0xdb65b11fa6bf1943acac1e31a82752e4d4d20934";

const artifact = await hre.artifacts.readArtifact("BtcPriceOracle");

const oracle = getContract({
  address: ORACLE_ADDRESS,
  abi: artifact.abi,
  client: publicClient,
});

const price = await oracle.read.latestPrice();
console.log("Latest BTC price:", Number(price) / 1e8, "USD");
