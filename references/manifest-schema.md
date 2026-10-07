# V2 structural mandate schema

Use `schema: "bnb-agent-vaults/mandate@2.0"`. This is a strict structural input for
`validate_mandate`; it is not a deployment record, factory approval, fork result, market
admission, wallet authorization or transaction plan. Unknown and retired top-level fields are
rejected. Execution still requires the server-held `deployment@1.0` record, current runtime
hashes, factory membership, live protocol checks, simulation and an externally authorized
wallet transaction.

The exact top-level fields are:

- `schema`: exactly `bnb-agent-vaults/mandate@2.0`.
- `chainId`: `56`, `97` or local `31337`.
- `creator`: nonzero EVM address.
- `agent`: nonzero EVM address distinct from the creator.
- `performanceFeeBps`: creator performance fee, integer `0..2000`.
- `template`: one complete canonical template whose route, legs, caps and `configHash` pass the
  same validation as a deployment record.
- `arbitraryCalls`: exactly `false`.
- `shareTransferable`: exactly `false`.
- `userCostBasis`: exactly `true`.
- `minIdleBps`: exactly `500`.
- `ruleChangeDelaySeconds`: exactly `86400`.
- `creatorMinOwnershipBps`: exactly `200`.
- `depositFeeBps`: exactly `50`.
- `operationFeeBps`: exactly `10`.
- `operationFeeAnnualCapBps`: exactly `100` per fixed 365-day accounting epoch.
- `protocolPerformanceFeeBps`: exactly `1000`.

The creator seeds exactly 100 accounting-asset units during the staged finalize transaction.
The same 0.5% entry fee applies to the seed, so `minSeedShares` must use
`expectedSeedSharesRaw(assetDecimals)` rather than a hard-coded gross 100-unit value. There is
no time lock or separate stake. While another holder remains, creator exits must leave at least
2% of live shares.

The fund share is the custom nontransferable `MANDATE_FUND_V2` interface. Cash exits settle
against actual proceeds and each holder's own cost basis, so this schema does not claim full
ERC-4626 preview conformance. Fixed fees are protocol rules, not caller choices.

## Canonical template

A template contains `id`, `label`, `asset`, `assetDecimals`, `route`, `legs`, `caps`,
`maxCapBps`, `configHash`, and optionally a bounded `reviewedDependencies` list. It has one to
seven unique underlying legs. Caps align one-for-one with legs and total no more than 9,500 bps,
leaving the fixed 5% idle reserve. Every non-accounting leg binds the exact router, factory,
pool, fee, token feed and oracle-age limit. Venus, Lista and Aave legs additionally bind their
exact market, receipt and provider fields. `configHash` is recomputed from the accounting asset,
route and ordered leg tuple; labels and symbols never authorize a market.

## Onchain Rules are separate

BuyOnce, finite/infinite DCA, DipOnly, NewMoney and BuySell behavior lives in the complete
Rules configuration committed during staged creation. Initial allocation uses
`initialCashBps`. Scheduled purchases use fixed UTC elapsed seconds, bounded execution windows
and no catch-up for missed slots. Dip uses a per-token high-water reference and per-token
cooldown between one hour and seven days; a failed transaction consumes neither a purchase nor
the cooldown. BuySell is available only when the immutable ordinary portfolio reports the
capability and emergency selling is enabled. Debt/LP Position portfolios reject basket
NewMoney and BuySell.

Token stop/target policies and holder-specific stop/take/trailing policies are nonce-bound
StopController actions, not mandate top-level fields. Agent-loss policy, fee claims, lifecycle
controls and the fixed 5% idle check are likewise enforced by their typed onchain modules.

The separate `bnb-agent-vaults/manifest@1.0` basket export remains available only through the
explicit reference-only `build_vault_manifest` and `validate_vault_manifest` tools. Earlier
`manifest@0.9` exports are rejected. Never translate a claimed dry-run, local planning fields or
user-selected routes from this reference format into V2 authority.
