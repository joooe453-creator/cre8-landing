---
name: bnb-agent-vaults
description: Design bStock and crypto baskets with per-asset hold, vault, or supply-market destinations, then resolve exact approved BNB Chain configurations and prepare bounded creation, deposits, redemptions, and PancakeSwap/Venus/Lista/Aave actions through the Sherwood MCP.
---

# BNB Agent Vaults

Use the continuous `bnb-agent-vaults/mandate@1.0` contracts (`MandateVault` and `MandatePortfolio`). A creator selects
exact markets and NAV caps; the operator has no privilege to redeem other people's shares or redirect execution proceeds.
Transactions remain unsigned until the user's wallet or their already-authorized agent signer reviews and signs them.
Never request a private key or silently expand a signer's authority.

When explaining results to a depositor or creator, say **vault value** for the current estimated value of the vault's
cash and investments, **share value** for the estimated value of one share, and **investment limit** for a position's
maximum percentage of current vault value. For example, a 70% limit on a 10,000-USDT vault means that position can be
worth at most 7,000 USDT when the contract checks an investment. These are current valuations, not original deposits or
guaranteed cash payouts. Keep NAV terminology and field names in technical schemas; do not change the calculation.

## Discovery and creation

Start with `list_phase1_markets`: choose bStock or crypto assets, their exact swap routes, and each asset's hold,
vault or supply-market destination. Do not replace this product flow with a list of protocol templates. A vault accepts
the selected asset; collateral-only markets are not lending destinations for that asset.

Call `get_execution_deployment` and `resolve_asset_selection`. The resolver binds the complete selected basket to an
internal reviewed configuration, orders caps to its legs, and rejects changed routes, mismatched destinations or ambiguity.
Individual approved legs do not authorize arbitrary combinations. An `undeployed` record is a hard execution gate:
design and export the basket, but never invent contract addresses, claim a fork pass, or treat a mainnet registry as
testnet configuration. Catalog membership alone is not execution approval. Verify the resolved configuration's chain,
asset, receipts, pools, feeds and hash. For schema and tool arguments, read
[execution.md](references/execution.md).

For creation, use separate creator, dedicated agent and risk-council keys. Set one NAV cap per selected asset; caps total
at most 9,500 bps. Seed exactly 100 accounting-asset units and disclose its 90-day share lock. The launch transaction
creates both contracts and seeds idle accounting assets atomically; the agent purchases later within the mandate.
Basket weights are agent planning targets, while caps are the enforced maximums; never describe weights or schedules
as contract-enforced allocation. Token approval may require a separate transaction. Total
performance fee is fixed at creation (0–3,000 bps), charged as shares above the post-fee watermark. Of those fee shares,
90% goes to the fixed creator recipient and 10% to the fixed protocol recipient; a 20% total means approximately18%/2%
of new marked profit, with share rounding. Management fees are absent in this version. Use `prepare_asset_vault_creation`,
verify factory approval, then call `simulate_asset_vault_creation` with the identical selection after token approval.
Low-level `prepare_mandate_creation` remains available for callers that already hold a reviewed configuration ID.
A mined `VaultCreated` event and `factory.isVault` identify the actual result.

## Operating a vault

Read `get_execution_health` and `get_vault_state` before acting; do not use a simulated website chart as NAV or spending authority. Only these
operations execute: a pinned direct PancakeSwap V3 exact-input swap (forward or reverse), holding its target,
Venus supply/redeem, Lista ERC-4626 deposit/redeem, and Aave V3 supply/withdraw. Borrowing, LP, leverage, Aster and
scheduled/drawdown basket automation are outside this execution contract. One underlying can use one venue per vault.

Use `prepare_vault_action`, then `simulate_vault_action` for the same arguments. All MCP amounts are raw decimal integer
strings, never floating-point numbers. Bind chain and account, use a short deadline and meaningful minimum output.
Current market listing, pause/capacity, receipt binding and oracle freshness are checked onchain. Swaps have an immutable
oracle-derived minimum, at most 1% below fair value; lending receipts have their own tight balance-delta checks.
A failed supply reverts the whole purchase rather than choosing a different destination. Allowances are bounded and cleared.

Create/deposit/execute require reviewed external provenance: runtime and proxy targets, full Venus Diamond dispatch,
Aave Pool/DataProvider/libraries, Pancake LM hook, and Lista underlying market/queue/cap/admission/fee/authority evidence.
Drift or unavailable required reads stops adding risk. This is an SDK/MCP gate, not an onchain veto over external governance;
never refresh its baseline automatically to unblock a trade. External Lista governance can change its underlying markets
and charge a separate yield fee. Receipt transfers may be paused by the external protocol.

A deploy call can return `false` and persist a loss pause without trading. Simulation reports `executionBlocked` and
`wouldPause`; an `eth_call` never persists that pause. Verify the mined vault's matching `Execution` or `ExecutionBlocked`
event (`minedExecutionOutcome` in the SDK); a successful receipt alone is not evidence of an executed trade. A daily loss checkpoint uses UTC contract days,
not a rolling 24-hour window. `checkRisk()` is permissionless; operators should call it when monitoring detects a loss.

After broadcast, persist the plan, nonce and tx hash; call `verify_operation_receipt` with `{plan, hash}`. Keep unknown,
pending, orphaned, reverted, mined and finalized distinct. An RPC timeout is not authorization to submit again. Unsupported
`finalized` stays unknown; fixed confirmation counts are not the finality signal. The intent `operationId` is not exactly-once
enforcement. Read [execution.md](references/execution.md) for reconciliation and provenance scope.

## Depositing and leaving

Deposits require both an exact token allowance and `depositWithMin` with positive minimum shares. Pricing accrues Venus
interest and performance fees before issuance. Cash redemption uses `redeemWithMin`: burn the holder's shares and withdraw
only their proportional inventories; liquidation costs are charged to that slice. Never replace it with full fund liquidation.
`estimatedRedeemAssets` is marked NAV. ERC-4626 `previewRedeem` deliberately quotes only the guaranteed idle share while
positions exist. Use the simulated redeem return for an executable estimate and explain state can change before inclusion.

If feeds or protocol liquidity prevent a cash exit, explain `redeemInKind`: the holder receives a proportional share of idle
cash, held assets, and fixed receipt tokens. It needs no swap/withdraw liquidity and does not promise those receipt tokens
can themselves be converted immediately. If NAV is unavailable, this emergency path waives an unpriceable accrued fee.
Best-effort pricing has a gas budget, with gas reserved for receipt transfers. Use gas estimation rather than a low fixed
gas limit; one leg requires about2.4m gas available, ten legs20.4m, although actual consumption can be lower.

Rules can tighten immediately; raising caps requires 24 hours and the exact scheduled commitment. Markets are immutable:
adding a market requires a new vault. Pausing or tightening caps must never be presented as disabling holder exits.
The seed owner can redeem only unlocked shares; the agent can redeem only shares it owns or has an actual ERC20 allowance for.

## Review boundaries

Read [manifest-schema.md](references/manifest-schema.md) only for an old basket/schedule `manifest@0.8` reference plan.
That schema does not deploy this vault and its schedule/rebalance fields are not onchain enforcement. Internal SMT claims
verify abstract accounting under stated assumptions; they are not a whole-bytecode proof or an independent audit.
