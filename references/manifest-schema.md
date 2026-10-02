# Phase-one vault manifest

Legacy reference plan only: this schema does not deploy MandateVault or enforce schedule/rebalance fields.

Use `schema: "bnb-agent-vaults/manifest@0.8"` and `chainId: 56`.

Required top-level fields:

- `identity`: name, symbol, non-binding note.
- `denomination`: registry-pinned BSC USDT.
- `owner` and a separate dedicated `manager.address`.
- `execution`: `lump-sum` or `accumulate`.
- `rebalancing`: disabled, cashflow-only, or bounded full buy/sell rebalancing.
- `portfolio.targets`: 1–10 exact registry targets whose integer `weightBps` sum to `10000`.
- `fees`: management fee 0–5%, performance fee 0–30%, vault-level high-water mark, no entry/exit fee.
- `seed`: at least 100 USDT, locked until close.
- `riskControls`: at least 5% idle, at most 1% slippage, bStock oracle age at most 3,900 seconds, oracle
  deviation at most 200 bps, market revalidation before every deposit, and `arbitraryCalls: false`.
- `forkDryRun`: must equal `passed-simulated` for the old reference validator; this is explicitly not an executed chain fork or deployment approval.

Each target copies `targetId`, symbol, category, token address, PancakeSwap V3 pool and fee from
`list_phase1_markets`. `postPurchase` is either:

- `{ "mode": "hold" }`; or
- an exact registry `yield-market` with its protocol and market address, `fallback: "hold"`, and
  `revalidateBeforeEveryDeposit: true`.

`lump-sum.deploymentBps` and `accumulate.maxDeploymentBps` cannot exceed `9500`.

Accumulation additionally requires `trancheBps` from 100–2500, at least one enabled schedule/drawdown trigger,
`sharedCooldownHours >= 24`, `insufficientCashPolicy: "skip-no-catch-up"`, and drawdown reference
`last-executed-basket-index`. An enabled schedule requires:

- `cadence.every` plus `cadence.unit` (`days`, `weeks`, or `months`), with at most one calendar year per interval;
- ISO `startAt` and an IANA `timeZone`;
- an end mode of `until-stopped`, `after-executions`, or `on-date`;
- `missedExecutionPolicy: "skip"`, `editPolicy: "next-cycle"`, and successful-buy-only execution counts;
- local clock preservation across daylight-saving changes and last-valid-day handling for short months.

Enabled rebalancing triggers when any target exceeds an absolute weight-drift floor of 100–2000 bps, with a cooldown of at least 24 hours, a
100–2500 bps turnover cap, `cashflowFirst: true`, and `preflightAllLegs: true`. Scheduled rebalancing checks on its
cadence but trades only when the drift floor is exceeded. Full rebalancing is invalid when any target uses a yield
destination; cashflow-only rebalancing remains valid because it does not need to withdraw or sell those positions.
Scheduled rebalancing also declares its own start time and time zone. Portfolio drawdown protection references the
settled-NAV high-water mark, pauses all new automated orders without liquidating, and requires manual resume.
