export function abiWords(hex) {
  if (typeof hex !== "string" || !/^0x(?:[0-9a-fA-F]{64})+$/.test(hex)) throw new Error("Invalid ABI response");
  return hex.slice(2).match(/.{64}/g);
}

export function abiUint(hex) {
  const words = abiWords(hex);
  if (words.slice(1).some((word) => BigInt(`0x${word}`) !== BigInt(0))) throw new Error("Unexpected uint padding");
  return BigInt(`0x${words[0]}`);
}

export function abiAddress(hex) {
  const words = abiWords(hex);
  if (!/^0{24}[0-9a-fA-F]{40}$/.test(words[0]) || words.slice(1).some((word) => BigInt(`0x${word}`) !== BigInt(0))) {
    throw new Error("Invalid address response");
  }
  return `0x${words[0].slice(-40)}`.toLowerCase();
}

export function abiAddressArray(hex) {
  const words = abiWords(hex);
  const count = Number(BigInt(`0x${words[1]}`));
  if (BigInt(`0x${words[0]}`) !== BigInt(32) || words.length !== count + 2) throw new Error("Invalid address array");
  return words.slice(2).map((word) => abiAddress(`0x${word}`));
}

const word = (address) => address.slice(2).toLowerCase().padStart(64, "0");
const boolean = (hex) => {
  const value = abiUint(hex);
  if (value !== BigInt(0) && value !== BigInt(1)) throw new Error("Invalid bool response");
  return value === BigInt(1);
};

export async function readSupplyStatus(market, call) {
  let checks;
  let supplyCap;
  let supplied;
  if (market.protocol === "Venus") {
    const controller = market.rateSource.comptrollerAddress;
    const arg = word(market.marketAddress);
    const [underlying, comptroller, listing, paused, protocolPaused, cap, shares, exchangeRate] = await Promise.all([
      call(market.marketAddress, "0x6f307dc3"), call(market.marketAddress, "0x5fe3b567"),
      call(controller, `0x8e8f294b${arg}`), call(controller, `0xe85a2960${arg}${"0".repeat(64)}`),
      call(controller, "0x425fad58"), call(controller, `0x02c3bcbb${arg}`),
      call(market.marketAddress, "0x18160ddd"), call(market.marketAddress, "0x182df0f5"),
    ]);
    if (abiAddress(underlying) !== market.assetAddress.toLowerCase() || abiAddress(comptroller) !== controller.toLowerCase()) {
      throw new Error("Venus asset/comptroller mismatch");
    }
    checks = { exactAsset: true, listed: boolean(`0x${abiWords(listing)[0]}`), mintNotPaused: !boolean(paused), protocolNotPaused: !boolean(protocolPaused) };
    supplyCap = abiUint(cap);
    supplied = abiUint(shares) * abiUint(exchangeRate) / BigInt("1000000000000000000");
  } else if (market.protocol === "Aave") {
    const { poolAddress, dataProviderAddress, addressesProviderAddress } = market.rateSource;
    const arg = word(market.assetAddress);
    const [underlying, aTokenPool, pool, dataProvider, aToken, config, paused, caps, totalSupply, reserveData, income] = await Promise.all([
      call(market.marketAddress, "0xb16a19de"), call(market.marketAddress, "0x7535d246"),
      call(addressesProviderAddress, "0x026b1d5f"), call(addressesProviderAddress, "0xe860accb"),
      call(poolAddress, `0xcff027d9${arg}`), call(dataProviderAddress, `0x3e150141${arg}`),
      call(dataProviderAddress, `0xb55d9904${arg}`), call(dataProviderAddress, `0x46fbe558${arg}`),
      call(market.marketAddress, "0x18160ddd"), call(dataProviderAddress, `0x35ea6a75${arg}`),
      call(poolAddress, `0xd15e0053${arg}`),
    ]);
    if (abiAddress(underlying) !== market.assetAddress.toLowerCase() || abiAddress(aTokenPool) !== poolAddress.toLowerCase()
      || abiAddress(pool) !== poolAddress.toLowerCase() || abiAddress(dataProvider) !== dataProviderAddress.toLowerCase()
      || abiAddress(aToken) !== market.marketAddress.toLowerCase()) throw new Error("Aave provider/reserve mismatch");
    const configWords = abiWords(config);
    if (configWords.length !== 10 || abiWords(caps).length !== 2 || abiWords(reserveData).length !== 12) throw new Error("Unsupported Aave configuration");
    const decimals = Number(BigInt(`0x${configWords[0]}`));
    if (decimals > 36) throw new Error("Unsupported asset decimals");
    checks = { exactAsset: true, active: boolean(`0x${configWords[8]}`), notFrozen: !boolean(`0x${configWords[9]}`), notPaused: !boolean(paused) };
    supplyCap = BigInt(`0x${abiWords(caps)[1]}`) * BigInt(10) ** BigInt(decimals);
    const ray = BigInt("1000000000000000000000000000");
    const treasury = BigInt(`0x${abiWords(reserveData)[1]}`);
    // Include pending treasury shares in the cap, rounding upward conservatively.
    supplied = abiUint(totalSupply) + (treasury * abiUint(income) + ray - BigInt(1)) / ray;
  } else if (market.protocol === "Lista") {
    const [asset, capacity] = await Promise.all([
      call(market.marketAddress, "0x38d52e0f"),
      // The prototype has no deployed adapter receiver. Execution must recheck its own receiver.
      call(market.marketAddress, `0x402d267d${word("0x0000000000000000000000000000000000000001")}`),
    ]);
    if (abiAddress(asset) !== market.assetAddress.toLowerCase()) throw new Error("Lista vault asset mismatch");
    const headroom = abiUint(capacity);
    return { supplyEnabled: headroom > BigInt(0), reason: headroom > BigInt(0) ? "Open at snapshot" : "Deposit capacity exhausted", checks: { exactAsset: true, hasDepositCapacity: headroom > BigInt(0) }, headroomRaw: headroom.toString(), receiver: "0x0000000000000000000000000000000000000001" };
  } else throw new Error("Unsupported supply market");

  // Venus Core treats cap=0 as closed; Aave treats cap=0 as uncapped.
  const unlimitedCap = market.protocol === "Aave" && supplyCap === BigInt(0);
  const headroom = unlimitedCap ? null : supplyCap > supplied ? supplyCap - supplied : BigInt(0);
  checks.hasSupplyCapacity = headroom === null || headroom > BigInt(0);
  const reasons = { listed: "market not listed", mintNotPaused: "supply paused", protocolNotPaused: "protocol paused", active: "reserve inactive", notFrozen: "reserve frozen", notPaused: "supply paused", hasSupplyCapacity: "supply cap reached" };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => reasons[name] || name);
  return { supplyEnabled: failed.length === 0, reason: failed.length ? `Unavailable: ${failed.join(", ")}` : "Open at snapshot", checks, supplyCapRaw: supplyCap.toString(), suppliedRaw: supplied.toString(), headroomRaw: headroom?.toString() ?? null, unlimitedCap };
}

export function currentDepositStatus(snapshot, market, now = Date.now()) {
  const row = snapshot?.markets?.[market.id];
  const age = now - Date.parse(row?.fetchedAt);
  if (row?.status !== "available" || !Number.isFinite(age) || age < -60000 || age > 86400000
    || row.assetAddress?.toLowerCase() !== market.assetAddress.toLowerCase()
    || row.marketAddress?.toLowerCase() !== market.marketAddress.toLowerCase()) return null;
  return row.deposit?.supplyEnabled === true ? row.deposit : row.deposit?.supplyEnabled === false ? row.deposit : null;
}
