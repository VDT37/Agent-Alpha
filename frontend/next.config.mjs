import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // this app has its own lockfile; don't let Next infer the hardhat repo as root
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
};

export default nextConfig;
