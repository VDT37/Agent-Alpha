import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import "dotenv/config";

export default {
  plugins: [hardhatToolboxViem],
  solidity: "0.8.28",
  networks: {
    somnia: {
      type: "http",
      url: process.env.SOMNIA_RPC_URL,
      chainId: 50312,
      accounts: [process.env.PRIVATE_KEY],
    },
  },
};
