import { readSupplyStatus, currentDepositStatus } from "./market-checks.mjs";
export { currentDepositStatus } from "./market-checks.mjs";

const YEAR_SECONDS = 365 * 24 * 60 * 60;
export const MAX_RATE_AGE_MS = 24 * 60 * 60 * 1000;
// A node this far from the wall clock is not serving the current chain, so its rates must not be stamped as fresh.
export const MAX_HEAD_LAG_MS = 5 * 60 * 1000;

export function annualizeApr(apr, periodsPerYear = 365) {
  if (!Number.isFinite(apr) || apr < 0 || !Number.isFinite(periodsPerYear) || periodsPerYear <= 0) {
    throw new Error("Invalid interest rate");
  }
  const apy = Math.expm1(periodsPerYear * Math.log1p(apr / periodsPerYear));
  if (!Number.isFinite(apy)) throw new Error("Interest rate overflow");
  return apy;
}

export function decodeUint(hex) {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]{64}(?:0{64})*$/.test(hex)) throw new Error("Invalid uint response");
  // Legacy Venus proxy calls can append zero words. Decode the ABI uint, not the whole byte string.
  return BigInt(hex.slice(0, 66));
}

export function parseRate(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value))) return null;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

export function currentRate(snapshot, market, now = Date.now()) {
  const rate = snapshot?.markets?.[market.id];
  const age = now - Date.parse(rate?.fetchedAt);
  if (rate?.status !== "available" || rate.assetAddress?.toLowerCase() !== market.assetAddress.toLowerCase()
    || rate.marketAddress?.toLowerCase() !== market.marketAddress.toLowerCase()
    || !Number.isFinite(age) || age < -60_000 || age > MAX_RATE_AGE_MS) return null;
  return typeof rate.baseApy === "number" ? parseRate(rate.baseApy) : null;
}

export function portfolioYield(rows, markets, snapshot, now = Date.now()) {
  if (!rows.length || rows.some((row) => !Number.isInteger(row.weightBps) || row.weightBps <= 0)
    || rows.reduce((sum, row) => sum + row.weightBps, 0) !== 10000) return null;
  let weighted = 0;
  for (const row of rows) {
    if (!row.marketId) continue; // Holding earns no lending interest; price returns are excluded.
    const market = markets.find((candidate) => candidate.id === row.marketId && candidate.targetId === row.targetId);
    if (!market) return null;
    if (currentDepositStatus(snapshot, market, now)?.supplyEnabled !== true) return null;
    const apy = currentRate(snapshot, market, now);
    if (apy === null) return null;
    weighted += row.weightBps / 10000 * apy;
  }
  return weighted * 0.95; // Fully invested scenario, keeping the mandated 5% cash reserve.
}

// The shared rates service reads once for the whole site; a visitor reads the sources itself only if it is unavailable.
export async function fetchSharedRates(url, { fetchFn = fetch } = {}) {
  const endpoint = new URL(url);
  const local = endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if ((endpoint.protocol !== "https:" && !local) || endpoint.username || endpoint.password) throw new Error("Shared rates URL must use HTTPS");
  const response = await fetchFn(endpoint.href, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Shared rates unavailable (${response.status})`);
  const snapshot = await response.json();
  if (snapshot?.schema !== "bnb-agent-vaults/yield-rates@1" || snapshot.chainId !== 56 || !snapshot.markets
    || typeof snapshot.markets !== "object" || Array.isArray(snapshot.markets) || !Number.isFinite(Date.parse(snapshot.fetchedAt))) {
    throw new Error("Invalid shared rate snapshot");
  }
  return snapshot;
}

export async function fetchYieldRates(registry, { rpcUrl = "https://bsc-dataseed.bnbchain.org", fetchFn = fetch } = {}) {
  let rpcId = 1;
  const raw = [];
  async function request(url, options = {}) {
    const response = await fetchFn(url, { ...options, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Rate source failed (${response.status})`);
    const body = await response.json();
    return body;
  }
  async function rpc(method, params) {
    const body = await request(rpcUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
    });
    if (body.error || body.result === undefined) throw new Error(body.error?.message || "Missing RPC result");
    raw.push({ method, params, result: body.result });
    return body.result;
  }
  if (Number(BigInt(await rpc("eth_chainId", []))) !== 56) throw new Error("Rate RPC is not BNB Chain");
  const blockTag = await rpc("eth_blockNumber", []);
  const block = await rpc("eth_getBlockByNumber", [blockTag, false]);
  const blockMs = /^0x[\da-f]+$/i.test(block?.timestamp ?? "") ? Number(BigInt(block.timestamp)) * 1000 : NaN;
  if (!/^0x[\da-f]{64}$/i.test(block?.hash ?? "") || !Number.isFinite(blockMs) || Math.abs(Date.now() - blockMs) > MAX_HEAD_LAG_MS) {
    throw new Error("Rate RPC head is stale or invalid");
  }
  const blockTime = new Date(blockMs).toISOString();
  const blockNumber = Number(BigInt(blockTag));
  const call = (address, data) => rpc("eth_call", [{ to: address, data }, blockTag]);
  const decodeAddress = (hex) => `0x${hex.slice(-40)}`.toLowerCase();
  const word = (address) => address.slice(2).toLowerCase().padStart(64, "0");
  const listaUrl = "https://api.lista.org/api/moolah/vault/list?page=1&pageSize=100&chain=bsc";
  const listaRequest = request(listaUrl).then((body) => {
    if (body.code !== "000000000" || !Array.isArray(body.data?.list)) throw new Error("Invalid Lista rate response");
    raw.push({ url: listaUrl, body });
    return body.data.list;
  }).catch((error) => ({ error: error.message }));
  const markets = {};
  const queue = [...registry.yieldMarkets];
  async function worker() {
    while (queue.length) {
      const market = queue.shift();
      const entry = { marketAddress: market.marketAddress, assetAddress: market.assetAddress, fetchedAt: new Date().toISOString() };
      try {
        const deposit = await readSupplyStatus(market, call);
        let baseApy;
        let sourceUrl;
        let methodology;
        let inputs;
        if (market.protocol === "Venus") {
          const [underlying, rateHex, modelHex] = await Promise.all([
            call(market.marketAddress, "0x6f307dc3"), call(market.marketAddress, "0xae9d70b0"), call(market.marketAddress, "0xf3fdb15a"),
          ]);
          if (decodeAddress(underlying) !== market.assetAddress.toLowerCase()) throw new Error("Venus underlying mismatch");
          const model = decodeAddress(modelHex);
          let blocksHex;
          try { blocksHex = await call(model, "0xa385fb96"); }
          catch { blocksHex = await call(model, "0xd37db1d2"); }
          const blocksPerYear = Number(decodeUint(blocksHex));
          const ratePerBlock = Number(decodeUint(rateHex)) / 1e18;
          baseApy = annualizeApr(ratePerBlock * blocksPerYear);
          sourceUrl = `https://bscscan.com/address/${market.marketAddress}#readProxyContract`;
          methodology = "Current supply rate, daily compounding; blocks/year read from the interest-rate model. Rewards excluded.";
          inputs = { supplyRatePerBlock: decodeUint(rateHex).toString(), blocksPerYear };
        } else if (market.protocol === "Aave") {
          const [underlying, pool, reserveData] = await Promise.all([
            call(market.marketAddress, "0xb16a19de"), call(market.marketAddress, "0x7535d246"),
            call(market.rateSource.dataProviderAddress, `0x35ea6a75${word(market.assetAddress)}`),
          ]);
          if (decodeAddress(underlying) !== market.assetAddress.toLowerCase()
            || decodeAddress(pool) !== market.rateSource.poolAddress.toLowerCase()) throw new Error("Aave reserve mismatch");
          const words = reserveData.slice(2).match(/.{64}/g);
          if (words?.length !== 12) throw new Error("Unsupported Aave reserve response");
          const liquidityRate = BigInt(`0x${words[5]}`);
          baseApy = annualizeApr(Number(liquidityRate) / 1e27, YEAR_SECONDS);
          sourceUrl = `https://bscscan.com/address/${market.rateSource.dataProviderAddress}#readContract`;
          methodology = "Current liquidity-rate APR in ray units, annualized with per-second compounding. Rewards excluded.";
          inputs = { liquidityRateRay: liquidityRate.toString() };
        } else if (market.protocol === "Lista") {
          const list = await listaRequest;
          if (list.error) throw new Error(list.error);
          const vault = list.find((candidate) => candidate.address?.toLowerCase() === market.marketAddress.toLowerCase());
          const asset = decodeAddress(await call(market.marketAddress, "0x38d52e0f"));
          if (!vault || vault.asset?.toLowerCase() !== market.assetAddress.toLowerCase() || asset !== market.assetAddress.toLowerCase()) {
            throw new Error("Lista vault asset mismatch");
          }
          baseApy = parseRate(vault.apy);
          if (baseApy === null) throw new Error("Lista APY unavailable");
          sourceUrl = `https://lista.org/lending/vault/bsc/${market.marketAddress}`;
          methodology = "Official Lista vault APY; not compounded again. Emission/campaign rewards excluded.";
          inputs = { reportedApy: vault.apy, emissionApyExcluded: vault.emissionApy };
        } else throw new Error("Unsupported rate source");
        markets[market.id] = { ...entry, status: "available", baseApy, sourceUrl, methodology, inputs, deposit, blockNumber, blockTime };
      } catch (error) {
        markets[market.id] = { ...entry, status: "unavailable", baseApy: null, error: error.message };
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const collateralMarkets = {};
  await Promise.all((registry.collateralMarkets || []).map(async (market) => {
    const entry = { fetchedAt: new Date().toISOString() };
    try {
      const [body, params] = await Promise.all([
        request(market.rateSourceUrl), call(market.marketAddress, `0x2c3c9157${market.id.slice(2)}`),
      ]);
      raw.push({ url: market.rateSourceUrl, body });
      const data = body.data;
      const words = params.slice(2).match(/.{64}/g);
      if (body.code !== "000000000" || data?.marketId !== market.id || data.chain !== "bsc"
        || data.loanToken?.toLowerCase() !== market.loanAddress.toLowerCase()
        || data.collateralToken?.toLowerCase() !== market.collateralAddress.toLowerCase()
        || words?.length !== 5 || decodeAddress(words[0]) !== market.loanAddress.toLowerCase()
        || decodeAddress(words[1]) !== market.collateralAddress.toLowerCase()) throw new Error("Lista collateral market mismatch");
      const nativeApy = parseRate(data.collateralNativeApy);
      if (nativeApy === null) throw new Error("Collateral APY unavailable");
      collateralMarkets[market.id] = { ...entry, status: "available", nativeApy, blockNumber };
    } catch (error) {
      collateralMarkets[market.id] = { ...entry, status: "unavailable", nativeApy: null, error: error.message };
    }
  }));
  // Callers replace their snapshot with this result, so a read where every source failed must not reach them.
  if (registry.yieldMarkets.length && !Object.values(markets).some((rate) => rate.status === "available")) {
    throw new Error("Every rate source failed; the previous snapshot is kept");
  }
  return {
    schema: "bnb-agent-vaults/yield-rates@1", chainId: 56, fetchedAt: new Date().toISOString(), blockNumber, blockTime,
    scope: "Base lending interest only; variable rates, price returns, reward emissions and vault fees excluded.",
    markets, collateralMarkets, raw,
  };
}
