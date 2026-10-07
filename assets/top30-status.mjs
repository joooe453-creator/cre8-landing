// Live tradability for the Top30 catalog. Every route pool, price feed and the BNB hop is read through Multicall3
// at one pinned block, so statuses shown side by side were true at the same moment. The checks mirror what the
// vault refuses on chain: a short observation ring, a missing 30-minute history, a stale feed, or a pool price more
// than 1% from Chainlink. Thin liquidity is not a refusal; it only lowers the per-order ceiling.

export const MAX_HEAD_LAG_MS = 5 * 60 * 1000;
const CHUNK = 50;
const Q96 = 2 ** 96;

const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const addressWord = (address) => address.slice(2).toLowerCase().padStart(64, "0");
const signed = (value) => (value >= 2n ** 255n ? value - 2n ** 256n : value);
const words = (hex) => (String(hex).slice(2).match(/.{64}/g) || []).map((chunk) => BigInt(`0x${chunk}`));

/** Multicall3.aggregate3 with allowFailure set on every call, so one missing history cannot sink the batch. */
export function encodeAggregate3(calls) {
  const heads = [];
  const tails = [];
  let offset = calls.length * 32;
  for (const call of calls) {
    const data = call.data.slice(2);
    const tuple = addressWord(call.target) + word(1) + word(96) + word(data.length / 2) + data.padEnd(Math.ceil(data.length / 64) * 64, "0");
    heads.push(word(offset));
    tails.push(tuple);
    offset += tuple.length / 2;
  }
  return `0x82ad56cb${word(32)}${word(calls.length)}${heads.join("")}${tails.join("")}`;
}

export function decodeAggregate3(hex) {
  const raw = String(hex).slice(2);
  const at = (byte) => Number(BigInt(`0x${raw.slice(byte * 2, byte * 2 + 64)}`));
  const array = at(0);
  const base = array + 32;
  return Array.from({ length: at(array) }, (_, index) => {
    const tuple = base + at(base + index * 32);
    const bytes = tuple + at(tuple + 32);
    return { success: at(tuple) === 1, data: `0x${raw.slice((bytes + 32) * 2, (bytes + 32 + at(bytes)) * 2)}` };
  });
}

const SLOT0 = "0x3850c7bd";
const LATEST_ROUND = "0xfeaf968c";
const BLOCK_TIME = "0x0f28c97d";
const balanceOf = (holder) => `0x70a08231${addressWord(holder)}`;
const observe = (window) => `0x883bdbfd${word(32)}${word(2)}${word(window)}${word(0)}`;

/** The routes worth reading: each Top30 target's hold route and, when it differs, the lending route. */
export function statusRoutes(registry) {
  return registry.targets.filter((target) => target.top30).flatMap((target) => {
    const hold = target.holdSwap || target.swap;
    const routes = [{ targetId: target.id, role: "hold", swap: hold }];
    if (hold !== target.swap) routes.push({ targetId: target.id, role: "lend", swap: target.swap });
    return routes;
  });
}

function decimalsOf(registry, address) {
  const key = address.toLowerCase();
  if (key === registry.quoteAsset.address.toLowerCase()) return registry.quoteAsset.decimals;
  if (key === registry.top30.hop.token.toLowerCase()) return 18;
  const target = registry.targets.find((candidate) => candidate.address.toLowerCase() === key);
  if (!target) throw new Error(`Unknown route token ${address}`);
  return target.decimals;
}

// Whole units of tokenOut per tokenIn from a Uniswap V3 price ratio (token1 raw per token0 raw).
function orient(rawRatio, hop, decimalsIn, decimalsOut) {
  const inIsToken0 = hop.tokenIn.toLowerCase() < hop.tokenOut.toLowerCase();
  return (inIsToken0 ? rawRatio : 1 / rawRatio) * 10 ** (decimalsIn - decimalsOut);
}

const usdText = (value) => (value >= 1e6 ? `$${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `$${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1)}K` : `$${value.toFixed(value >= 100 ? 0 : 2)}`);
export function ageText(seconds) {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * One route's status from decoded reads. `pools` maps a pool address to { slot0, observe, balances }, `feeds` maps a
 * feed address to { answer, updatedAt } (or null when unreadable).
 */
export function routeStatus(registry, swap, feed, { pools, feeds, blockTime }) {
  const policy = registry.top30.policy;
  const quoteFeed = registry.top30.quoteFeed;
  const fail = (state, reason, extra = {}) => ({ state, ok: false, thin: false, reason, maxOrderUsd: null, liquidityUsd: null, ...extra });
  if (!feed) return fail("no-feed", "No reviewed Chainlink USD feed on BNB Chain");
  const tokenFeed = feeds.get(feed.address.toLowerCase());
  const usdtFeed = feeds.get(quoteFeed.address.toLowerCase());
  if (!tokenFeed || tokenFeed.answer <= 0n || !usdtFeed || usdtFeed.answer <= 0n) return fail("feed-unavailable", "Chainlink price feed could not be read");
  const age = blockTime - tokenFeed.updatedAt;
  if (age > feed.maxAge) return fail("stale-feed", `Chainlink price is stale · updated ${ageText(age)} ago, limit ${ageText(feed.maxAge)}`);
  if (blockTime - usdtFeed.updatedAt > quoteFeed.maxAge) return fail("stale-feed", "Chainlink USDT price is stale");
  const usdtUsd = Number(usdtFeed.answer) / 10 ** quoteFeed.decimals;
  const oracle = Number(tokenFeed.answer) / 10 ** feed.decimals / usdtUsd;

  const reads = swap.path.map((hop) => pools.get(hop.poolAddress.toLowerCase()));
  if (reads.some((read) => !read?.slot0)) return fail("unavailable", "Pool could not be read");
  // Depth and prices first, so a route that cannot trade yet still shows how deep it is.
  let spot = 1;
  let twap = reads.every((read) => read.twapTick !== null) ? 1 : null;
  let reserveUsd = Infinity;
  let liquidityUsd = Infinity;
  let valueIn = null;
  // Walk from the accounting asset back to the token, so each hop's quote side is already valued in USD.
  for (let index = swap.path.length - 1; index >= 0; index -= 1) {
    const hop = swap.path[index];
    const read = reads[index];
    const decimalsIn = decimalsOf(registry, hop.tokenIn);
    const decimalsOut = decimalsOf(registry, hop.tokenOut);
    const hopSpot = orient((Number(read.slot0.sqrtPriceX96) / Q96) ** 2, hop, decimalsIn, decimalsOut);
    const outUsd = valueIn ?? usdtUsd;
    const quoteUsd = Number(read.balances.out) / 10 ** decimalsOut * outUsd;
    reserveUsd = Math.min(reserveUsd, quoteUsd);
    liquidityUsd = Math.min(liquidityUsd, quoteUsd + Number(read.balances.in) / 10 ** decimalsIn * hopSpot * outUsd);
    valueIn = hopSpot * outUsd;
    spot *= hopSpot;
    if (twap !== null) twap *= orient(1.0001 ** read.twapTick, hop, decimalsIn, decimalsOut);
  }
  const cardinality = Math.min(...reads.map((read) => read.slot0.cardinality));
  const usable = reserveUsd > 0 && Number.isFinite(spot) && spot > 0;
  const measured = { cardinality, liquidityUsd: usable ? liquidityUsd : 0, reserveUsd: usable ? reserveUsd : 0,
    maxOrderUsd: usable ? Math.floor(reserveUsd * policy.maxOrderReserveBps / 10000 * 100) / 100 : 0, priceUsd: oracle * usdtUsd };
  const routeFee = swap.path.reduce((sum, hop) => sum + hop.fee, 0);
  const limit = policy.maxDeviationBps / 10000;
  const spotGap = Math.abs(spot / oracle - 1);
  const twapGap = twap === null ? null : Math.abs(twap / oracle - 1);
  const pct = (value) => `${(value * 100).toFixed(1)}%`;
  if (reads.some((read) => !read.slot0.unlocked)) return fail("locked", "Pool is locked mid-transaction · retry shortly", measured);
  if (routeFee > policy.maxRouteFee) return fail("fee-too-high", `Pool fees ${(routeFee / 10000).toFixed(2)}% exceed the ${(policy.maxRouteFee / 10000).toFixed(1)}% route budget`, measured);
  if (!usable) return fail("no-liquidity", "Pool has no usable liquidity", measured);
  if (cardinality < policy.minObservationCardinality) {
    return fail("needs-history", `Price history ${cardinality.toLocaleString("en-US")} / ${policy.minObservationCardinality.toLocaleString("en-US")} slots · capacity upgrade pending`, measured);
  }
  if (twap === null) return fail("needs-history", "30-minute price history not yet recorded", measured);
  if (spotGap > limit) return fail("price-off", `Pool price ${pct(spotGap)} from Chainlink · limit ${pct(limit)}`, measured);
  if (twapGap > limit) return fail("price-off", `30-minute average ${pct(twapGap)} from Chainlink · limit ${pct(limit)}`, measured);
  const thin = reserveUsd < policy.minQuoteReserveUsd;
  return { state: "ok", ok: true, thin, reason: thin ? `Thin pool · max ${usdText(measured.maxOrderUsd)} per order` : `Max ${usdText(measured.maxOrderUsd)} per order`, ...measured };
}

/** The issue, if any, with sending an order of `orderUsd` through a route whose live status is `status`. */
export function orderIssue(status, orderUsd) {
  if (!status) return null;
  if (!status.ok) return status.reason;
  if (orderUsd > status.maxOrderUsd) return `Order ${usdText(orderUsd)} is above the live max ${usdText(status.maxOrderUsd)} (0.1% of pool depth)`;
  return null;
}

/** Read every Top30 route at one block. Throws only when the chain itself cannot be read. */
export async function fetchTop30Status(registry, { rpcUrl = registry.discovery.rpcUrl, fetchFn = fetch, now = Date.now() } = {}) {
  let id = 1;
  async function rpc(method, params) {
    const response = await fetchFn(rpcUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`BSC RPC returned ${response.status}`);
    const body = await response.json();
    if (body.error || body.result === undefined) throw new Error(body.error?.message || "BSC RPC error");
    return body.result;
  }
  if (Number(BigInt(await rpc("eth_chainId", []))) !== registry.chainId) throw new Error("RPC is not connected to BNB Chain");
  const blockTag = await rpc("eth_blockNumber", []);
  const routes = statusRoutes(registry);
  const multicall = registry.top30.multicall;
  const calls = [{ target: multicall, data: BLOCK_TIME, read: "time" }];
  const pools = new Map();
  const feeds = new Map();
  const addFeed = (feed) => {
    if (!feed || feeds.has(feed.address.toLowerCase())) return;
    feeds.set(feed.address.toLowerCase(), null);
    calls.push({ target: feed.address, data: LATEST_ROUND, read: "feed", key: feed.address.toLowerCase() });
  };
  addFeed(registry.top30.quoteFeed);
  for (const route of routes) {
    addFeed(registry.targets.find((target) => target.id === route.targetId).top30.feed);
    for (const hop of route.swap.path) {
      const key = hop.poolAddress.toLowerCase();
      if (pools.has(key)) continue;
      pools.set(key, { slot0: null, twapTick: null, balances: { in: 0n, out: 0n } });
      calls.push({ target: hop.poolAddress, data: SLOT0, read: "slot0", key });
      calls.push({ target: hop.poolAddress, data: observe(registry.top30.policy.twapWindowSeconds), read: "observe", key });
      calls.push({ target: hop.tokenIn, data: balanceOf(hop.poolAddress), read: "in", key });
      calls.push({ target: hop.tokenOut, data: balanceOf(hop.poolAddress), read: "out", key });
    }
  }
  const results = [];
  for (let start = 0; start < calls.length; start += CHUNK) {
    const chunk = calls.slice(start, start + CHUNK);
    const decoded = decodeAggregate3(await rpc("eth_call", [{ to: multicall, data: encodeAggregate3(chunk) }, blockTag]));
    if (decoded.length !== chunk.length) throw new Error("Multicall returned the wrong number of results");
    results.push(...decoded);
  }
  let blockTime = null;
  calls.forEach((call, index) => {
    const { success, data } = results[index];
    const values = success ? words(data) : [];
    if (call.read === "time") blockTime = values.length ? Number(values[0]) : null;
    else if (call.read === "feed") feeds.set(call.key, values.length >= 5 ? { answer: signed(values[1]), updatedAt: Number(values[3]) } : null);
    else if (call.read === "slot0") {
      if (values.length >= 7) pools.get(call.key).slot0 = { sqrtPriceX96: values[0], tick: Number(signed(values[1])), cardinality: Number(values[3]), unlocked: values[6] === 1n };
    } else if (call.read === "observe") {
      // tickCumulatives[] sits at the first offset: [window ago, now]; Solidity rounds the mean toward negative infinity.
      const at = values.length ? Number(values[0]) / 32 : 0;
      if (values.length >= at + 3) {
        const delta = signed(values[at + 2]) - signed(values[at + 1]);
        const window = BigInt(registry.top30.policy.twapWindowSeconds);
        pools.get(call.key).twapTick = Number(delta / window - (delta < 0n && delta % window !== 0n ? 1n : 0n));
      }
    } else if (values.length) pools.get(call.key).balances[call.read] = values[0];
  });
  if (blockTime === null) throw new Error("Block time could not be read");
  if (Math.abs(now - blockTime * 1000) > MAX_HEAD_LAG_MS) throw new Error("BSC RPC head is stale");
  const targets = {};
  for (const route of routes) {
    const target = registry.targets.find((candidate) => candidate.id === route.targetId);
    const status = routeStatus(registry, route.swap, target.top30.feed, { pools, feeds, blockTime });
    targets[route.targetId] ||= {};
    targets[route.targetId][route.role] = status;
    if (route.role === "hold" && !target.holdSwap) targets[route.targetId].lend = status;
  }
  return { blockNumber: Number(BigInt(blockTag)), blockTime, fetchedAt: new Date(blockTime * 1000).toISOString(), targets };
}
