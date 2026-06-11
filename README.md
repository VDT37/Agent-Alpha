# Autonomous On-Chain Trading Vault

**A trading strategy whose entire reasoning is consensus-verified and permanently recorded on-chain. It cannot lie about what data it read or why it traded.**

Users deposit a stablecoin into a vault on **Somnia's Agentic L1** (Shannon testnet). The vault then runs a fully on-chain, multi-agent decision loop: it fetches the BTC price, reads live crypto news, asks an LLM for a 0–100 buy conviction, sizes the position with deterministic volatility-targeting math, has a _second_, independent LLM agent approve or veto the trade, and only then swaps on an AMM. Every step is an agent request whose result was consensus-verified by Somnia validators and emitted as an append-only event. No off-chain bot can make this claim: anyone can replay the vault's full reasoning history from the chain and get the identical, tamper-proof record.

## Architecture

```
                        ┌──────────────────────────────────────────────────────┐
                        │                   TradingVault.sol                   │
 trigger ──────────────►│ checkAndTrade()                                      │
 (manual / cron keeper) │    │ 1. JSON API agent ── BTC price (CoinGecko)      │
                        │    ▼                                                 │
                        │ _onPrice()  ── store price + rolling history         │
                        │    │ 2. LLM Parse Website agent ── news sentiment    │
                        │    ▼         (search mode, 3 articles, CoinDesk)     │
                        │ _onNews()                                            │
                        │    │ 3. LLM Inference agent ── inferNumber:          │
                        │    ▼         conviction 0–100 to BUY                 │
                        │ _onDecision()                                        │
                        │    │   deterministic sizing:                         │
                        │    │   fraction = min(targetVol/currentVol, 1)       │
                        │    │              × conviction/100                   │
                        │    │ 4. LLM Inference agent #2 ── risk officer:      │
                        │    ▼         "approve" / "veto"                      │
                        │ _onVeto() ──► SimpleAMM.swap(mUSD → mETH)            │
                        │                                                      │
                        │ guardrails: pause · max-trade cap · slippage floor   │
                        │   · conviction floor · vol throttle · fuel checks    │
                        └──────────────────────────────────────────────────────┘
```

Each agent call is **asynchronous**: the contract fires `createRequest` on the Somnia Agents platform, validators execute the agent off-EVM and reach consensus, and the platform calls back `handleResponse` seconds later. The decision logic lives _inside the callbacks_, each callback fires the next agent's request, so the whole chain is on-chain composability, paid for from the vault's own STT "fuel" balance.

## How it leverages Somnia's Agentic L1

- **All three base agents, chained on-chain:** JSON API Request (price) → LLM Parse Website (news sentiment, search mode) → LLM Inference (decision).
- **Two LLM functions:** `inferString` (constrained `approve`/`veto`) _and_ `inferNumber` (integer conviction 0–100, range-clamped by the platform).
- **Agent-to-agent composition:** an analyst agent proposes, an independent risk-officer agent must approve before capital moves — a two-agent "trading desk" enforced by contract code.
- **Consensus-verified reasoning:** every agent result was agreed by a 3-validator subcommittee _before_ the contract acted on it, and is recorded in events (`PriceChecked`, `NewsAnalyzed`, `ConvictionScored`, `VetoRequested`, `SizedTradeExecuted`, …).
- **Async callback model done safely:** platform-only callback gate, per-request kind tracking, `status == Success` checks before decoding, `receive()` for deposit refunds, balance checks before every paid call.

## The position-sizing math (Phase E)

> **Principle: the AI provides the directional view and conviction; deterministic on-chain math provides the risk-adjusted sizing.** This separation mirrors real systematic funds — the LLM never picks the trade size directly.

```
base_fraction     = target_vol / current_vol          (capped at 1.0 — no leverage)
conviction_mult   = conviction / 100                  (LLM inferNumber output)
final_fraction    = base_fraction × conviction_mult
trade_size (mUSD) = final_fraction × available_capital   (clamped ≤ maxTradeStable)
```

- **Volatility targeting** is hedge-fund standard (see e.g. Moreira & Muir, _Volatility-Managed Portfolios_, Journal of Finance 2017): scale exposure down when realized volatility is high, up when markets are calm.
- **Conviction-weighted sizing** scales that risk budget by the strength of the signal.
- `current_vol` is the **mean absolute return** over the last ≤8 stored prices — a legitimate volatility proxy (mean absolute deviation of returns) chosen because Solidity has no native `sqrt`; it is integer-friendly and ~as informative as std-dev for this purpose.
- All ratios use **fixed-point arithmetic** (`SCALE = 1e18`): multiply before dividing, divide out one `SCALE` per scaled multiply, cap the base fraction at 1.0. The math is unit-tested against a hand-computed worked example in [test/TradingVault.math.ts](test/TradingVault.math.ts).

The result self-throttles: same conviction in a turbulent market → smaller position. The full trail — price → sentiment → conviction → volatility → fraction → trade size — is emitted on-chain per loop.

## Guardrails & stability

| Guardrail                          | What it does                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paused` circuit breaker           | Owner can halt deposits and new loops instantly.                                                                                                                    |
| `maxTradeStable`                   | Hard per-trade ceiling regardless of what the sizing math says.                                                                                                     |
| Slippage floor                     | Swap reverts if output < 95% of the AMM quote.                                                                                                                      |
| Conviction floor (`minConviction`) | Sub-threshold conviction = hold, no noise trades.                                                                                                                   |
| Volatility throttle                | Sizing shrinks automatically in turbulent markets.                                                                                                                  |
| Risk-veto agent                    | A second, independent LLM must approve every sized trade (`vetoEnabled`). Fail-safe: if the veto call can't be made or fails, the trade is _skipped_, not executed. |
| Graceful degradation               | Low fuel → emit `DecisionSkipped` and stop, never revert mid-chain (a revert would roll back already-stored data).                                                  |

## Independent verification

```bash
npx hardhat run scripts/auditTrail.js --network somnia
```

prints the vault's complete decision/trade history straight from chain events — timestamps, prices, sentiments, convictions, vetoes, trades, tx hashes. Anyone can run it against the vault address and obtain the identical record; nothing is served from a private database.

## Known limitations (stated honestly)

- **Flat deposit accounting.** `deposits[user]` ignores trading P&L; after trades the vault may hold mUSD+mETH while the ledger only tracks deposited mUSD. Proper fix is share-based accounting (mint/burn shares against total pot value) — on the roadmap.
- **Off-chain trigger.** A contract can't wake itself; `checkAndTrade` is fired manually/by a script for the demo. Production would use a dumb-clock keeper, GitHub Actions cron, Gelato/Chainlink Automation, or Somnia's reactivity precompile (most agent-native). All intelligence and guardrails stay in the verified contract, so autonomy is not compromised.
- **Single news source** (CoinDesk search via the Parse Website agent). Multi-source consensus is roadmap.
- **Demo scenario override.** The owner can inject a market-context string into the conviction prompt for deterministic on-camera demos. The AI still reasons, only its inputs are steered, and every use is emitted as `ScenarioSet`, so it's visible in the audit trail.
- **Testnet escape hatches.** `rescueFuel`/`rescueToken` let the owner recover STT/tokens from an instance before redeploying (testnet iteration), and would be removed or timelocked in production.

## Roadmap

Share-based P&L accounting · decentralized keeper · multi-source news consensus · sell-side logic (currently long-only) · event-driven frontend alerts.

## Repo layout

| Path                                                             | What it is                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| [contracts/TradingVault.sol](contracts/TradingVault.sol)         | The vault: agent chain, sizing math, veto, guardrails.                |
| [contracts/SimpleAMM.sol](contracts/SimpleAMM.sol)               | Minimal constant-product AMM (mUSD/mETH), 0.3% fee.                   |
| [contracts/TestToken.sol](contracts/TestToken.sol)               | Open-mint ERC-20 (deployed as mUSD and mETH).                         |
| [contracts/NewsOracle.sol](contracts/NewsOracle.sol)             | Standalone tester for the Parse Website agent.                        |
| [contracts/ConvictionOracle.sol](contracts/ConvictionOracle.sol) | Standalone tester for `inferNumber`.                                  |
| [scripts/](scripts)                                              | Deploy, fund, deposit, trigger, read, audit (Hardhat 3 + ESM + viem). |
| [test/TradingVault.math.ts](test/TradingVault.math.ts)           | Fixed-point sizing math unit tests.                                   |
| [frontend/](frontend)                                            | Next.js + wagmi/RainbowKit dashboard (live reasoning feed).           |

## Setup & run

**Environment:** Node 18+, a burner wallet funded with Shannon STT (Google Cloud Web3 faucet). `.env`:

```
SOMNIA_RPC_URL=https://dream-rpc.somnia.network
PRIVATE_KEY=0x...
```

**Network:** Somnia Shannon testnet — chain id `50312`, explorer `https://shannon-explorer.somnia.network/`. Agents platform: `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`.

**First-time infra (once):**

```bash
npx hardhat run scripts/deployTokens.js --network somnia   # → paste mUSD, mETH into addresses.js
npx hardhat run scripts/deployAMM.js    --network somnia   # → paste amm into addresses.js
```

**After any vault contract change:**

```bash
npx hardhat compile
npx hardhat run scripts/deployVault.js --network somnia    # → paste vault + vaultDeployBlock into addresses.js
npx hardhat run scripts/fundVault.js   --network somnia    # STT fuel (a full loop costs ~0.81 STT with veto on)
npx hardhat run scripts/deposit.js     --network somnia    # mUSD capital (once per vault)
```

**Run & observe the loop (repeatable):**

```bash
npx hardhat run scripts/trigger.js    --network somnia     # fires the chain, walks all 4 callbacks
npx hardhat run scripts/readState.js  --network somnia     # free read-only snapshot
npx hardhat run scripts/auditTrail.js --network somnia     # full on-chain reasoning history
```

**Standalone agent testers** (verify params before trusting them in the vault):

```bash
npx hardhat run scripts/testNews.js       --network somnia
npx hardhat run scripts/testConviction.js --network somnia
```

**Unit tests:**

```bash
npx hardhat test
```

**Frontend:**

```bash
node scripts/exportAbi.js          # copies ABIs + addresses into frontend/lib/
cd frontend && npm install && npm run dev
```

## Deployed addresses (Shannon)

See [scripts/addresses.js](scripts/addresses.js) — mUSD/mETH/AMM are stable; the vault address changes on each redeploy.

## Demo video

[https://youtu.be/4abbufjuBdQ](https://youtu.be/4abbufjuBdQ)
