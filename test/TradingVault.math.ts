import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { parseEther } from "viem";

// Unit tests for the Phase E fixed-point math (computeVolFP / previewFraction),
// using the worked example from the build spec §7.2 as the fixture:
//   abs returns 0.4%, 0.6%, 0.5%  ->  vol = 5e15 (0.5%)
//   target_vol = 1e16 (1%)        ->  base fraction = 2.0, capped at 1.0
//   conviction 80                 ->  final fraction = 0.8 = 8e17

const SCALE = 10n ** 18n;

// BTC prices in 8 decimals, constructed so consecutive abs returns are EXACTLY
// 0.4%, 0.6%, 0.5% (divisions come out with no remainder).
const CALM_PRICES = [
  6_000_000_000_000n, // 60,000.00000000
  6_024_000_000_000n, // +0.4%
  5_987_856_000_000n, // -0.6%
  6_017_795_280_000n, // +0.5%
];

// Exact 4% moves -> vol = 4e16, which exceeds the 1% target and throttles sizing.
const TURBULENT_PRICES = [
  1_000_000_000_000n, // 10,000.00000000
  1_040_000_000_000n, // +4%
    998_400_000_000n, // -4%
];

describe("TradingVault Phase E math", async function () {
  const { viem } = await network.create();
  const [wallet] = await viem.getWalletClients();

  // Math tests never touch the platform/tokens/AMM, so any address works.
  const DUMMY = wallet.account.address;

  async function deployVault() {
    return viem.deployContract("TradingVault", [
      DUMMY, DUMMY, DUMMY, DUMMY, parseEther("1000"),
    ]);
  }

  it("computes mean absolute return volatility (worked example: 0.5%)", async function () {
    const vault = await deployVault();
    await vault.write.seedPriceHistory([CALM_PRICES]);

    const vol = await vault.read.computeVolFP();
    assert.equal(vol, 5n * 10n ** 15n); // (4e15 + 6e15 + 5e15) / 3
  });

  it("sizes the worked example to 0.8 of capital (base capped at 1.0, conviction 80)", async function () {
    const vault = await deployVault();
    await vault.write.seedPriceHistory([CALM_PRICES]);

    const [vol, fraction] = await vault.read.previewFraction([80n]);
    assert.equal(vol, 5n * 10n ** 15n);
    // base = 1e16 * 1e18 / 5e15 = 2.0 -> capped to 1.0; * 0.8 conviction = 0.8
    assert.equal(fraction, 8n * 10n ** 17n);
  });

  it("falls back to target vol (neutral sizing) with insufficient history", async function () {
    const vault = await deployVault();

    const vol = await vault.read.computeVolFP();
    assert.equal(vol, await vault.read.targetVolFP()); // 1e16

    // base = target/target = 1.0; conviction 50 -> 0.5
    const [, fraction] = await vault.read.previewFraction([50n]);
    assert.equal(fraction, 5n * 10n ** 17n);
  });

  it("throttles position size in a turbulent market", async function () {
    const vault = await deployVault();
    await vault.write.seedPriceHistory([TURBULENT_PRICES]);

    const [vol, fraction] = await vault.read.previewFraction([80n]);
    assert.equal(vol, 4n * 10n ** 16n); // 4%
    // base = 1e16/4e16 = 0.25; * 0.8 conviction = 0.2 -> only 20% of capital
    assert.equal(fraction, 2n * 10n ** 17n);
  });

  it("zero conviction sizes to zero", async function () {
    const vault = await deployVault();
    await vault.write.seedPriceHistory([CALM_PRICES]);

    const [, fraction] = await vault.read.previewFraction([0n]);
    assert.equal(fraction, 0n);
  });

  it("caps seeded history at HISTORY_LEN", async function () {
    const vault = await deployVault();
    const tooMany = Array.from({ length: 12 }, (_, i) => 1_000_000_000_000n + BigInt(i));
    await vault.write.seedPriceHistory([tooMany]);

    assert.equal(await vault.read.priceHistoryLength(), 8n);
  });

  it("owner-only setters guard the strategy knobs", async function () {
    const vault = await deployVault();
    await vault.write.setTargetVol([2n * 10n ** 16n]); // 2%
    assert.equal(await vault.read.targetVolFP(), 2n * 10n ** 16n);

    await vault.write.setMinConviction([70n]);
    assert.equal(await vault.read.minConviction(), 70n);

    // with target 2% and vol 0.5%, base is still capped at 1.0
    await vault.write.seedPriceHistory([CALM_PRICES]);
    const [, fraction] = await vault.read.previewFraction([100n]);
    assert.equal(fraction, SCALE);
  });
});
