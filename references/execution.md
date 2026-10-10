# V2 unsigned MCP execution

This version describes the current source, not an officially deployed contract or live MCP host.
`get_execution_deployment` returns reviewed basket `deployment@1.0`; `get_position_deployment`
returns reviewed `positions@2.0`; `get_position_creation_catalog` returns the server-held
`position-creation-catalog@2.0`; `get_composite_spot_deployment` and `get_composite_deployment`
return the two composite manifests. All five public records are undeployed; current source has
63 unsigned tools. No tool accepts a caller
RPC/manifest, secret, signature request or broadcast instruction. Tool schemas and typed SDK
canonical reconstruction jointly enforce input; arbitrary calldata is not an operation input.
Hex identities (`vault`, `account`, `id`, `hash`) of the mixed composite tools are additionally
bounded at the route to exact 20-byte or 32-byte `0x` strings before any SDK call.

## Ordinary creation

`prepare_asset_vault_creation` / `simulate_asset_vault_creation`:
`{selection,account,name,symbol,agent,performanceFeeBps,minSeedShares,deadline,rules?,metadataURI?}`.
Asset selection is `{chainId,accountingAsset,positions,automation,managementFeeBps:0,seedAmount:"100"}`;
positions retain exact token/direct V3 swap/destination/cap fields from the reviewed resolver.
An idle accounting asset is not an extra hold leg. Maximum seven legs and caps sum 9500.
The resolver accepts a complete reviewed configuration, not an arbitrary mix of approved parts.
For an ordinary fund, `minSeedShares` is not a slippage choice: it must equal
`expectedSeedSharesRaw(assetDecimals)`, the exact 100-unit seed after the fixed 1% creation fee.
The SDK rejects both higher and lower values before any staged transaction is prepared.

`prepare_mandate_creation` / `simulate_mandate_creation` replace `selection` with
`{templateId,capBps}`. Fee 0–2000 bps. All amounts and startAt/frozenMask are canonical decimal raw
integer strings; deadlines are Unix seconds. Server reads creatorNonce and pinned VaultDeployer;
clients must not provide guessed deployer/nonce fields. `rules` uses the complete RulesConfig below.

Phase one produces `action:"create-prepare"` with `creation@2.0 {prepareData,vaultDeployer,key}`.
Preserve the whole original plan. `prepare_mandate_creation_step` and
`simulate_mandate_creation_step` use `{plan,step:"deploy"|"finalize"|"cancel",cancelDeadline?}`.
Only cancel uses its new cancelDeadline. Each phase retains exact creator/config/Rules/seed
commitment; only finalize pulls 100 accounting units and registers the fund. Its plan.approval
specifies exact token/spender/amount. External wallet approvals and phase execution are separate.

## Position Factory creation

`prepare_position_creation` / `simulate_position_creation`:
`{catalogId,account,expiresAt}`. Only the server catalog supplies creator, accounting asset and
its decimals, complete StageConfig/Rules, Factory/source pins and an optional exact externally
reviewed module prerequisite. No caller RPC/config/bytecode/constructor/admission DTO exists.
An undeployed or missing catalog fails closed. Creator must be a direct EOA; Factory Safe/4337
creation is unsupported until a dedicated exact outer-envelope verifier exists.

`prepare_position_creation_step` / `simulate_position_creation_step`:
`{plan:completePositionCreationPlan,step:"deploy"|"portfolio"|"finalize"|"cancel"|
"approval-reset"|"approval-exact",expiresAt}`. Step uses the exact saved current-nonce-derived
commitment and onchain phase. StageConfig is
`{asset,name,symbol,agent,recipient,performanceFeeBps,cap,minSeedShares,deadline}`;
recipient is the fixed creator, agent distinct, fee ≤2000 and cap ≤9500. Rules must be complete
and compatible with Position's no-basket-rebalance capability.

The plan schema is `position-creation-plan@2.0`; fields are
`{schema,chainId,from,to,data,value:"0",phase,creation,expiresAt,deadlineEnforcement,
latestAllowedTimestamp,delayedExecutionPossible,blockNumber,blockHash,gasLimitRaw,simulation,
module?,approvalAmount?}`. `creation` retains
`{catalogId,creatorNonce,stage,rules,graph,configHash,rulesHash,salt,key,predictedVault}`.
`graph` retains deployer/policyDeployer/fundDeployer/scheduleDeployer/validator/operations/
riskGuard/council/protocolRecipient/vaultImplementation. The predicted vault is the CREATE2
clone of that pinned implementation whose salt binds every creation parameter; staged vault
and bridge code must equal those exact clones. The guard runtime, platform constants and
`guard.operations == operations` are pinned at the same block/hash. Module metadata retains exact address/portfolio/key/configHash/
runtimeHash. Simulation includes canonical result/current-state gas and simulationOnly:true.

Prepare → deploy → portfolio → finalize are four separate Factory transactions. Only final
seed pulls 100 accounting units and registers custody. Dynamic staged addresses/core require
explicit independently reviewed server pins before the next stage; auto-discovery does not
admit source. Module deployment/dependencies/provenance, owner scheduling + 12-hour admission (none on BNB Chain testnet),
and recorder/catalog review remain external release gates. Final seed/approval require the
exact admitted module key and controller/asset/capability/config/runtime graph. These tools
never deploy arbitrary bytecode or approve owner module admission.

Approval-reset emits approve(Factory,0); approval-exact emits approve(Factory,100 units),
requires current zero allowance and separate exact receipt verification before fresh finalize.
`get_position_creation_state {plan}` checks latest stage at one canonical block/hash.
`registered` means onchain phase4; `catalogAuthorized` additionally needs the exact reviewed
bound module/stored bridge moduleCodeHash/dependencies and current admission. Owner revocation
does not erase registration. Completed phases expose currentAgent/agentEnabled from the pinned
Governance graph; a legitimate delayed rotation does not rewrite initial StageConfig or fail
creation reconciliation. Before seed the initial agent commitment remains mandatory.
`finalizedRegistration` requires a separately checked canonical finalized phase4 snapshot;
`finalizedState` exposes its status/block/hash/phase. Missing or lagging finality cannot certify
registration. Actual bound module mismatch fails closed. Pure ABI event evidence has no finality
authority; receipt finalizedRegistration is gated on canonical finalized receipt evidence.
`verify_position_creation_receipt {plan,hash}` checks original network transaction, canonical
block/finality, unique phase Factory events, original commitment and actual stage; finalize also
requires unique exact kernel SeedDeposited and Factory membership. Preparatory receipt success
does not mean registration. Unknown/pending/mined/orphaned/reverted/finalized remain distinct.

Local expiry is fresh chain time +1..900 seconds. Prepare/deploy/finalize use original stage
deadline, portfolio uses its stored stage deadline, cancel embeds fresh expiresAt and retains
original commitment even after original expiry. Approval has only local expiry. Review original
stage (≤30 days) and planned program start against external admission delay; delayed signatures
are not cancelled by local expiry. Missing external prerequisites explicitly block finalize.

## Ordinary operations

`prepare_vault_action` / `simulate_vault_action`: common `{action,vault,account,deadline}`.
Capital actions require `expectedPolicyEpoch` from verified state; control actions need
`expectedControlNonce`. No receiver/owner override. Positive user minima except SDK-defined
unused/receipt fields; canonical SDK checks all action-specific amounts, unused fields and bounds.

| action | Additional fields |
|---|---|
| deposit | assets,minShares,expectedPolicyEpoch |
| mint | shares,maxAssets,expectedPolicyEpoch |
| execute | leg,assets,minTokenOut,minReceipt,expectedPolicyEpoch |
| unwind | leg,fractionBps,minAssets,expectedPolicyEpoch |
| exit-market | leg,fractionBps,minTokens,expectedPolicyEpoch |
| redeem | shares,minAssets |
| redeem-in-kind | shares |
| risk-check | none |
| pause,resume,disable-agent,cancel-agent,apply-agent,cancel-caps,harvest-fee | expectedControlNonce |
| schedule-agent | expectedControlNonce,nextAgent |
| tighten-caps,schedule-caps,apply-caps | expectedControlNonce,caps complete array |

`get_vault_state {vault,account?}` includes policyEpoch/rulesSnapshot and same-block custody/NAV;
when `account` is supplied, the same pinned block also includes that holder's personal-stop
policy and current nonce. Governance supplies queue getters. `get_vault_management_state {vault,account}` is
pricing-independent authority/current nonce/queues. Neither read implies a simulation pass.

## V2 Rules

`prepare_vault_rules_action` / `simulate_vault_rules_action` and Position equivalents use
`{vault,account,request,expiresAt}`. Preparation already includes canonical preflight/eth_call
and current-state gas estimation. Ordinary tools return an UnsignedPlan with full `rulesPlan`;
Position Rules tools return standalone RulesPlan. Preserve either complete representation.

| request.action | Exact fields |
|---|---|
| rules-control | operation:{action,expectedNonce,deadline,leg,pendingNonce,config} |
| agent-loss-control | operation:{action,limitBps,expectedNonce,deadline} |
| program | epoch,key,leg,amount,minTokenOut,minReceipt,deadline |
| rebalance-buy | epoch,leg,amount,minTokenOut,minReceipt,deadline |
| reduction | kind,epoch,leg,fraction,minimum,deadline |
| time-checkpoint | epoch,deadline |
| token-stop-set | leg,stopPriceX18,targetPriceX18,expectedNonce,deadline |
| token-stop-apply / token-stop-cancel / token-buyback-schedule / token-buyback-apply / token-stop-trigger | leg,expectedNonce,deadline |
| personal-stop-set | lossBps,takeProfitBps,trailingBps,expectedNonce,deadline |
| personal-peak / personal-stop-trigger | owner,expectedNonce,deadline |
| claim-fees | receiver,deadline |
| keeper-deleverage | epoch,amount,minRepaid,deadline (Debt only) |

Reduction kind is ExecutionKind 3 RebalanceSell, 4 EmergencySell, or 5 ClosingSell. Emergency and
closing sales run only for the manager, the council or the enabled agent; a rebalance sale stays rule-bound.
A raised token stop applies at once only while it is at least 5% below the leg's live risk price; a closer
stop, one above the price or one set while the price cannot be read is scheduled for the 24-hour review
(the receipt shows which). A buy-once program keeps its start, slots, interval, window and recovery timing.

Rules control action: Pause0,Resume1,Emergency2,End3,Freeze4,Tighten5,Schedule6,Cancel7,
Apply8,ResumeDeposits9. Empty unused tuple fields must stay canonical zero/empty. Token stop,
buyback and personal-stop requests bind their current monotonic nonce and a short onchain deadline.
Cash and in-kind share exits use the direct vault/Position action APIs; shares are nontransferable
and creator exits enforce the live 2% ownership floor without a time lock.

RulesConfig is complete:
`{strategy,rebalance,emergencySellEnabled,startAt,intervalSeconds,windowSeconds,totalSlots,
recoverySlots,recoveryIntervalSeconds,recurringCashBps,dipDropBps,dipCashBps,drawdownPauseBps,
autoStopLossBps,rebalanceThresholdBps,weights,frozenMask,initialCashBps,dipCooldownSeconds}`.
`drawdownPauseBps` and `autoStopLossBps`
are retired and must be 0; strategy 1 (USDT lending) is rejected. Strategy enums and compatible profiles
are validated by SDK/contract; a free-form config is not permission to enable unsupported modes.
Dip requires at least 300 bps and enabled rebalancing requires at least 500 bps. Agent loss
policy is per vault, defaults to 500 bps and the creator may choose 200-1000 bps (Cancel carries 0). Twenty-five hourly buckets
cover the trailing 24 hours and may retain the oldest bucket for up to one extra hour. The
crossing action completes before the Agent is disabled; holder exits and manager reductions
remain separate paths, so the configured percentage is not a hard maximum-loss guarantee.
RulesSnapshot includes current/stored lifecycle, nonce/epoch, pending policy, token-stop state,
optional account-bound personal-stop policy, capabilities, Agent loss policy/rolling loss and
progress (remaining/consumed/missed slots, stall/deposit halt, dip/next time, program
nonce/emergency count/rebalance cash/frozen cash), with the complete runtime-pinned immutable
core graph.

## Registered Position operation/approval

`get_position_state {vault}` inspects a server-reviewed Debt or LP capability.
`prepare_position_action` / `simulate_position_action`:
`{vault,account,request,deadline}` (short 15-minute chain-time window).

| request.action | Exact fields |
|---|---|
| deposit | amount,minimum,expectedPolicyEpoch |
| deploy | amount,minimum:0,minUnits,expectedPolicyEpoch |
| unwind | amount:fractionBps,minimum,expectedPolicyEpoch |
| redeem | amount:shares,minimum:cash |
| in-kind | amount:shares,minimum:0 |
| debt | expectedPolicyEpoch,operation:{kind,amount,minimum,loops,enabled,deadline} |
| control | operation:{action,expectedNonce,deadline,caps,nextAgent} |

Debt kind0borrow/1loop/2repay/3deleverage/4collateral requires capability-specific role,
amount/minimum/loops and zero unused fields. SDK/contract remain authoritative.
`prepare_position_approval {vault,account,deposit:{action:"deposit",amount,minimum,
expectedPolicyEpoch},deadline,reset:boolean}` prepares exact reset or exact amount. Verify reset
receipt before nonzero approval and approval receipt before freshly preparing deposit.
No tool invents a successful deposit simulation while allowance is missing.
Registered operation tools require an already finalized reviewed Position. Use the separate
Position Factory workflow above for staged creation; module deployment/admission remains external.

## Safe and verification

`prepare_safe_handoff {policy,inner}` supports canonical `{kind:"operation",plan}`,
`{kind:"approval",plan,amount:"0"|exactParentApproval}` or `{kind:"rules",plan:RulesPlan}`;
factory governance remains typed. `prepare_position_safe_handoff` supports
`{kind:"position",plan}`, `{kind:"approval",plan:PositionApprovalPlan}` or `{kind:"rules",plan}`.
Safe policy is separately reviewed 1.4.1 runtime/singleton/EOA owners/quorum. No sign/broadcast tool.

| verifier | Fields |
|---|---|
| verify_operation_receipt | plan:completeUnsignedPlan,hash:networkTxHash |
| verify_vault_rules_receipt | plan:RulesPlan,hash |
| verify_position_creation_receipt | plan:PositionCreationPlan,hash |
| verify_position_receipt | plan:PositionPlan,hash |
| verify_position_approval_receipt | plan:PositionApprovalPlan,hash |
| verify_position_rules_receipt | plan:RulesPlan,hash |
| verify_safe_receipt / verify_position_safe_receipt | policy,envelope:originalCompleteEnvelope,hash:networkTxHash |

Creation metadata and Rules snapshot/request must stay attached. Canonical SDK validators
reconstruct target/caller/value/calldata/nonce/epoch/amount/minimum and reject altered plans.
EOA and Safe outer hashes use different verification paths. Unknown/pending/orphaned are not
failure-to-broadcast proofs. Status 1 without the unique outcome event is not a trade. RPC canonical finalized is
required; fixed confirmation counts are not substituted. Approval/raw-exit local expiry cannot
cancel already signed calls; cancellation must consume the Safe nonce with confirmed evidence.
Agent capital-action receipts additionally require the pinned RiskGuard emitter, indexed vault,
action hash, heartbeat, reason, loss evidence and any threshold-crossing circuit event.

History is finalized oracle-marked/net-pending-fee PPS, with real event/coverage metadata;
publisher/RPC/archive completeness is a trust boundary. Aster API equity is not fund NAV.

## PR20 composite status

Call `get_strategy_v3_status` for the strategy-v3 release report. The payload is derived at
build time from three sources and never hand-edited: the published mixed manifest
(`executionAvailable` and `officialFactory` only when it validates as `deployed`), a per-tool
table transcribed from the engineering handoff (`tools[].state` in `spec-only` →
`implemented-local` → `verified-fork` → `deployed`, with `notes` naming the fork suite and open
acceptance gaps), and the handoff's release blockers (`releaseBlockers[]`). `tools[].executable`
is true only when the manifest is deployed and the state is beyond `spec-only`; the SDK's
`assertStrategyV3Executable` refuses everything else. `rules.evidence` records that there is no
public deployment, no signed finalized broadcast, no external audit and no hosted CI. Both
composite lifecycles below have their own manifests and selectors. Preserve the V2 and Position
schemas and limits; do not route T01–T19 through old selectors.

## Direct spot composite lifecycle

Discover `get_composite_spot_deployment` (`composite-spot@1.0`,
`MANDATE_COMPOSITE_V3_SPOT`). Undeployed means design only. Public-chain releases require
reviewed factory/deployer/registry runtimes, exact external route pins and complete proxy
provenance. Reads use EIP-1898 `requireCanonical` with no numeric fallback. Pending factory
creations are identified separately and never advertised as official vaults.

`prepare_composite_spot_action {request:{action,account,vault?,parameters},expiresAt}` returns
a `composite-plan@1.0` unsigned single CALL. Expiry is at most 900 seconds after the chain
header. Preserve the plan unchanged; simulation rebuilds its parameters and graph. Where
`deadlineEnforcement=local-only`, expiry cannot cancel delayed wallet broadcasts.

Creation stages are `create-kernel` (reviewed `catalogId`, distinct `agent`, UTF-8 name/symbol,
0–2000 `feeBps`; recipient fixed to creator), seven `create-infrastructure` calls (phase 0–6),
`create-wire`, one `create-scope` per position (`catalogId,id,funding,capBps,compoundBps`),
then `create-seal`. Keep verified `KernelPrepared`/`InfrastructurePrepared` receipts for
recovery; the factory's pre-wire infrastructure mapping is private. Do not guess an address
or infer a missing phase from local UI state. Simulation rejects already completed stages.

The factory owner separately prepares `schedule-activation`. Once the review window has
passed (zero on BNB Chain testnet 97, one day on every other chain; `activation.readyAt` in
`get_composite_state`) and the fresh graph/epoch/component checks hold, the creator prepares
`activate {minimumShares}`. The same window applies to `catalog-schedule` → `catalog-execute`
and to an agent change.
Only activation approves exactly 100 accounting units to the verified factory. No seed is
pulled during the earlier stages. There are at most 8 direct scopes, caps total at most 9500
bps, nontransferable shares and a 2% live creator ownership requirement, not staking.

`deposit {maximum,minimumShares,version}` and `mint {shares,maximum,version}` approve only
the maximum budget to the verified parent. Call `preview_composite_spot_deposit {vault,maximumRaw}` for an indicative share prequote; it never changes the owner's reviewed minimum. Physical inventory replication, a 0.5% entry fee
and refunds determine actual used assets. Previews/minima are not ERC-4626 guarantees.
`allocate {scope,amount,version}`, `reserve` and `execute {id}` use manager/current enabled
agent authority; reservation includes the scope nonce, lot, fixed Buy/Sell tokens and a
deadline. `minimumUnits` is zero; Sell uses the principal bucket. Buy inputs can use principal
or compound. Funds pay no operation fee, so a buy needs only its own cash in the bucket.

Withdraw using `request-withdrawal {shares,minimum}`, then `partition-withdrawal {id}`.
Read `get_composite_withdrawal`; convert each noncash token with
`convert-claim {id,token,minimum}`, then `complete-withdrawal {id}`. Permissionless progress
never changes the recipient. The owner can amend a queued/partitioned minimum and deadline,
cancel only while queued, or `claim-in-kind {id}` after partition. Stale prices keep NAV null
and can waive in-kind fees; do not automatically weaken minimums or fall back to physical
delivery without the owner's explicit review. Physical fees remain in escrow and are floored
per token; quoted fee value is not guaranteed to equal delivered token granularity.

Verify every receipt using `verify_composite_spot_receipt {plan,hash}`. Exact transaction,
canonical block, pinned factory and fixed helper emitters are required. Return receipt-derived
vault/withdrawal/intent IDs, never model guesses. Unknown/pending/orphaned/reverted are distinct
and never authorize automatic retry. EOA browser submission reuses the shared wallet journal,
cross-tab lock, account/provider change guard and exact approvals. Safe/4337 signing and a
durable automated composite signer are not yet available; old keeper records cannot be reused.

## Mixed composite lifecycle (native positions)

Discover `get_composite_deployment` (`MANDATE_COMPOSITE_V3_NATIVE`, public manifest
`mandate-mixed.json`, chain 97 first). It is the mixed parent of `MandateCompositeMixedVault`:
at most 8 spot scopes plus native positions (supply on Aave/Venus/ERC4626/Lista, isolated
collateral debt, Pancake V3/V2/Infinity LP, MasterChef farm, BNB staking, FX-wrapped variants)
behind one share, one NAV and one withdrawal queue. Undeployed means design only: every tool
below answers `Mixed composite contracts are undeployed; execution disabled`. A deployed manifest
still requires the factory/catalog/helper graph, runtime pins and provenance to verify at a
canonical block before any plan is produced. Signing stays in the user's wallet (holders,
creators, council) or the operator's dedicated agent key (keeper); this service never signs,
broadcasts, stores keys or accepts an RPC URL.

Reads: `get_composite_vault_state {vault,account}` returns the verified graph, scopes (with their
sealed cash group) and native positions, holder shares and locked shares, cost basis, agent
status, `navRaw` (null when any valuation is unavailable; raw exits do not need it), the exit
policy (`minimumRequest` is both the smallest deposit after the fee and the smallest partial
withdrawal measured on cost basis; a whole unlocked balance always leaves), council holds
(`councilHoldUntil` for native operator actions, `spotCouncilHoldUntil` for new spot
reservations), creation progress read from the chain (`creation.infrastructurePhases` and
`creation.nativePhases`), and `receipts`: the account's native exit receipts (CRE8-NR) with
balances. `get_composite_withdrawal_state {vault,id}` returns the owner, state, minimum,
deadline, claim tokens, native claim slices, and raw tokens that leave only in kind (an exit
receipt names the receipt token it redeems for). `get_composite_native_intent {vault,id}`
returns one native typed intent's stored request, status and asset version from the verified
NativeExecutor. `get_composite_catalog_admission {vault?}` returns every reviewed catalog key's
approved/blocked state, nonce, the factory ownership epoch and any pending proposal: the exact
values `catalog-schedule {key,nonce,epoch}`, `catalog-revoke {key,nonce,epoch}` and
`catalog-execute {key,nonce}` must quote. `id` and `hash` are exact 32-byte hex; `vault` and
`account` exact 20-byte hex.

`prepare_composite_action {request:{action,account,vault?,parameters},expiresAt}` returns an
unsigned single-CALL plan. The exact action list and the per-action parameter schema are the
SDK's `mixedParameters` (`web/lib/mandate-mixed.ts`); `mixedRequestSchema` is the `anyOf` of
those actions and is embedded verbatim in the tool schema, so every action has a fixed,
closed parameter set with no receiver, calldata, protocol configuration or route field.
Action families: staged creation (`prepareKernel`, infrastructure phases, native
infrastructure phases, wiring, spot scopes, native positions by reviewed catalog key, the
write-once whole-fund exit policy `configure-exit-policy` (required before sealing), optional
`configure-cash-group` (2–8 unfunded equity spot scopes) and `configure-emergency` (up to 7
unencumbered sources for one debt position), seal, scheduled activation and activation with
the exact 100-unit seed approval), holder lifecycle (`depositWithMin`/`mintWithMax` approving
only the maximum budget, `requestWithdrawal`, amend/cancel, permissionless partition,
per-position claim settlement and raw settlement through `positionAction`, cash completion or
`claimInKind`, then `redeem-receipt {token,units}` to turn a CRE8-NR exit receipt into the
underlying receipt token), manager native actions
(fund, release, harvest, compound, migration, borrow/repay, unstake queue, top-up and the
D06 emergency sources, each a typed `positionAction` with numerator/denominator/maximum/
minimum semantics fixed per action), controls (pause, agent schedule/apply/disable, loss
policy) and council/owner admission (catalog schedule/execute/revoke, asset approval, block,
activation scheduling). A council cancel of an operator's staged native intent (or of a spot
intent) opens a one-day hold: new operator reservations stop, holder settlements still run.
Executing a staged native intent must quote exactly the stored fields; a staged intent, or a
reserved spot intent, blocks deposits and partitioning until it is executed or cancelled.
Expiry is at most 900 seconds after the chain header; where
`deadlineEnforcement` is `local-only`, expiry cannot cancel delayed wallet broadcasts.
Preserve the plan unchanged.

`simulate_composite_action {plan}` and `verify_composite_receipt {plan,hash}` take the
complete saved plan (`mixedPlanSchema`): simulation rebuilds the request, graph fingerprint
and provenance before `eth_call`/`estimateGas` under the BSC gas reserve; verification requires
exact from/to/data/value identity, the pinned factory and helper emitters and RPC-reported
finality, and recovers vault, withdrawal and intent IDs only from verified events.
Unknown, pending, orphaned, reverted, mined and finalized stay distinct; none authorizes a retry.
Debt positions with outstanding liabilities cannot be raw-settled; reduce debt first.

### Keeper policy handoff

`build_composite_keeper_policy {vault,account,role:"agent"|"manager",scopes:[{id,kind:"spot"|
"native",actions}],maxGasPriceWei,maxGasLimit?,confirmations?,withdrawals?:{fromBlock,
maximumScanBlocks,maximumPending},maintenanceActions?,policyActions?}` reads the verified vault
state and returns `{policy,handoff,trust}`. `scopes` (1–8, each a verified scope of the vault)
and the gas price ceiling are required; strategy groups are derived from the vault's sealed
cash groups for spot scopes allowed to `move`. `policy` is the keeper's
own schema-3 execution policy (`execution/strategy-v3/ethereum.mjs` `validateExecutionPolicy`):
chain, factory, vault, account, role, `graphHash` (= `nativeGraphHash()`), runtime pins for the
factory, parent and every graph helper (and each native position's internal dependents),
bounded scope authorities for spot and native scopes, groups that equal sealed cash groups,
gas and confirmation bounds, encoded with the keeper's `{$uint}` bigint
form so it can be saved verbatim. The route refuses any policy that embeds a URL, RPC endpoint,
signer or key field, so the response never carries `CRE8_STRATEGY_RPC_URL` or
`CRE8_STRATEGY_AGENT_KEY` values. The operator reviews the policy, sets `abiHash` from
`node execution/strategy-v3/bundle-abi.mjs --check`, `strategyHash`/`observerHash` from the
reviewed strategy and observer files and `withdrawals.fromBlock` to the vault creation block,
then runs `node execution/strategy-v3/cli.mjs verify|prepare|execute|recover --policy …
--strategy … --observer … --journal …` on the operator host. Only `execute` signs, with the
dedicated key for `policy.account`; the RPC URL and key live only in that host's environment,
never in the repository, the manifest or any MCP exchange. The policy grants no wallet
authority: the onchain agent role and the operator's key do.
