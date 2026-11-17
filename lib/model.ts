// Token Radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks EVERY protocol that passes the watchlist's own eligibility rule (not just the 40
// on the watchlist): it records no token (no market cap, no CoinGecko id, no symbol), it is not a
// CEX, a bridge or a liquid-staking product, its name carries no version marker and no whole word
// wrapped / staked / staking, and it does not begin with an exchange's name. That rule is applied
// to all 758 protocols, so the board is 198 rows: the 40 watchlist rows plus 158 early rows the
// floor leaves out. A protocol that already trades is never ranked: the live-token set is kept
// apart and shown with its market cap, the market's own value, never a model's.
//
// Implied value follows only from the snapshot's own figures, and no protocol name is ever
// special-cased:
//
//   base     = the live market's own median mcap/TVL, from this same snapshot (live protocols
//              trade at a median of about 0.20x TVL), clamped to [0.10, 0.40]
//   growth   = clamp(change_7d, -50, 150) per cent
//   growthMult   = 1 + (growth / 100) x 0.6
//   maturity     = 0.65 + min(age_days, 1095) / 1095 x 0.35   (age unknown: 365 days)
//   breadth      = 1 + 0.025 x min(chains - 1, 6)             (multi-chain reach, capped)
//   implied  = max(1, round(tvl_usd x base x growthMult x maturity x breadth))
//
// Age is the time since DefiLlama first listed the protocol: how long it has run with no token.
// The dashboard's app.js carries this same arithmetic (impliedOf) and recomputes every row, so
// the page's code and board.json are visibly the same model.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the page recomputes them. */
export interface ModelConstants {
  base_multiple: number;
  live_median_ratio: number;
  live_count: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A live-token protocol near one row's TVL, trading near the live median multiple: its market anchor. */
export interface Comparable {
  slug: string;
  name: string;
  mcap_usd: number;
  ratio: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  signals: string[];
  comparable: Comparable | null;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  signals: string[];
  comparable: Comparable | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted list, or null when it is empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The model's constants, derived from the snapshot itself: the base multiple is the live market's
 * own median market-cap-to-TVL ratio across the protocols in this snapshot that already trade,
 * clamped to [0.10, 0.40] so one snapshot's extremes cannot stretch it. Nothing is hardcoded by name.
 */
export function modelFor(snapshot: Snapshot): ModelConstants {
  const ratios = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd)
    .sort((a, b) => a - b);
  const liveMedian = median(ratios) ?? 0.2;
  const base = Math.min(0.4, Math.max(0.1, liveMedian));
  return {
    base_multiple: Math.round(base * 10000) / 10000,
    live_median_ratio: Math.round(liveMedian * 10000) / 10000,
    live_count: ratios.length,
    growth_weight: 0.6,
    growth_floor: -50,
    growth_cap: 150,
    maturity_floor: 0.65,
    maturity_range: 0.35,
    maturity_days: 1095,
    unknown_age_days: 365,
    breadth_per_chain: 0.025,
    breadth_max_extra: 6,
  };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extra = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra);
  const breadthMult = 1 + extra * model.breadth_per_chain;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking in a name: a product of a token that already trades. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
/** Categories that are a wrapped, bridged or staked product, not a protocol awaiting a launch. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
/** Exchange names a protocol name must not begin with. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all (a missing field counts as no record). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd == null && p.gecko_id == null && p.symbol == null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and passing the watchlist's own
 * eligibility rule as far as the snapshot shows it (category, name and exchange prefix). A
 * protocol the snapshot cannot clear on those grounds is set aside, never ranked.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  const cat = (p.category ?? '').toLowerCase();
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (cat.includes('bridge') || cat.includes('wrapper')) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/**
 * The market anchor for one implied value: among the live-token protocols whose TVL is within
 * 3x of this protocol's (10x when none is), the one whose market-cap-to-TVL ratio sits closest
 * to the live market's median. A nearest-by-TVL pick alone can land on an outlier (a live
 * protocol whose token trades at 0.02x TVL), which would anchor nothing.
 */
export function comparableFor(p: SnapshotProtocol, live: SnapshotProtocol[], medianRatio: number): Comparable | null {
  const pick = (lo: number, hi: number): SnapshotProtocol | null => {
    let best: SnapshotProtocol | null = null;
    let bestDist = Infinity;
    for (const l of live) {
      if (l.mcap_usd === null || l.tvl_usd <= 0 || p.tvl_usd <= 0) continue;
      const size = l.tvl_usd / p.tvl_usd;
      if (size < lo || size > hi) continue;
      const dist = Math.abs(Math.log(l.mcap_usd / l.tvl_usd / medianRatio));
      if (dist < bestDist) {
        bestDist = dist;
        best = l;
      }
    }
    return best;
  };
  const best = pick(1 / 3, 3) ?? pick(0.1, 10) ?? pick(0, Infinity);
  if (best === null || best.mcap_usd === null) return null;
  return { slug: best.slug, name: best.name, mcap_usd: best.mcap_usd, ratio: Math.round((best.mcap_usd / best.tvl_usd) * 10000) / 10000 };
}

/** Short signals read straight off one row's figures, for the board and the detail view. */
export function signalsFor(p: SnapshotProtocol, age: number | null, watchlist: boolean): string[] {
  const s: string[] = [];
  if (watchlist) s.push('Watchlist');
  const g = p.change_7d;
  if (g !== null && g >= 15) s.push('Surging');
  else if (g !== null && g <= -15) s.push('Cooling');
  if (age !== null && age < 180) s.push('New');
  if (age !== null && age >= 1095) s.push('Veteran');
  if (p.chains.length >= 4) s.push('Multi-chain');
  return s;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const liveAll = snapshot.protocols.filter((p) => !isPreToken(p));
  const chosen = snapshot.protocols.filter((p) => isRankable(p));
  // The watchlist is the floor: every slug on it must be ranked, even if the eligibility rule
  // above would set it aside on the fields the snapshot shows (it cannot, but coverage is the
  // gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && !chosen.includes(p)) chosen.push(p);
  }
  const scored = chosen.map((p) => {
    const { implied, growthPct, growthMult, maturityMult, breadthMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, breadthMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    signals: signalsFor(s.p, s.age, watch.has(s.p.slug)),
    comparable: comparableFor(s.p, liveAll, model.live_median_ratio),
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  return 60;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What one transaction costs on a protocol's first chain, by how expensive that chain is. */
function gasFor(p: SnapshotProtocol): string {
  const chain = chainOf(p);
  if (chain === 'Ethereum') return '$5 to $15 of gas';
  if (chain === 'Bitcoin' || chain === 'Tron') return 'about $2 of gas';
  return 'under $2 of gas';
}

/** The category's primary action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the supply open so the position earns.`;
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain}, paired with USDC, and keep the position open.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the vault shares.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and keep the shares.`;
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('curator')) return `Deposit $${capital} of USDC into a ${name} curator vault on ${chain} and keep the vault shares.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('interest rate') || c.includes('basis trading')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position.`;
  if (c.includes('staking') || c.includes('restaking')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('prediction')) return `Fund ${name} with $${capital} on ${chain} and place one position on a market that settles within the month.`;
  if (c.includes('stablecoin') || c.includes('dual-token') || c.includes('anchor btc') || c.includes('decentralized btc')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} through its official bridge and use ${name}'s flagship app with the funds.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action, so the wallet shows two kinds of activity. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $20 of USDC against the supply on ${name}, then repay it within the week so the borrow side is also on record.`;
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm')) return `Swap $25 of USDC through ${name} on ${chain} and leave the receipt in the farming wallet.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('curator') || c.includes('capital allocator')) return `Move $25 into a second vault on ${name} so two vaults show activity from the same wallet.`;
  if (c.includes('rwa')) return `Redeem $25 of the asset and re-mint it through ${name}, so both directions are on record.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('interest rate') || c.includes('basis trading')) return `Close the position and open a fresh one the following week, keeping the size near $25.`;
  if (c.includes('staking') || c.includes('restaking')) return `Add $25 more stake through ${name} and delegate it if ${name} offers a choice of operators.`;
  if (c.includes('prediction')) return `Place a second $10 position on a different ${name} market the next week.`;
  if (c.includes('stablecoin') || c.includes('dual-token') || c.includes('anchor btc') || c.includes('decentralized btc')) return `Swap $25 of the asset through ${name}'s own route on ${chain} and hold the result.`;
  if (c.includes('chain')) return `Stake or deposit $25 of the bridged funds in ${name}'s main app on ${chain}.`;
  if (c.includes('insurance')) return `Extend the cover by $25 before it lapses so the policy stays continuous.`;
  return `Make a second $25 deposit into ${name} the following week.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL and age), never from a hand-written list
 * of names. Every step carries what it costs and how long it takes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm with ${p.name}, and keep its seed phrase offline.`,
      cost: gas + ' for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, chain),
      cost: 'about $25 of capital and one transaction fee',
      time: '10 minutes',
    },
    {
      text: `Repeat one qualifying action each week on ${p.name}, a deposit, a swap, a vote or a claim, so the wallet shows steady activity and not a single burst.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Open ${p.name}'s own points or rewards page once a week and check what counted, using only links the protocol itself publishes.`,
      cost: 'no fee to check',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, claim only from the link ${p.name} itself publishes, never pay to claim, then revoke the approval and write the wallet, the dates and every transaction in a farm log.`,
      cost: 'nothing but the log',
      time: '10 minutes',
    },
  ];
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    watchlist: row.watchlist,
    signals: row.signals,
    comparable: row.comparable,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = modelFor(snapshot);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside: snapshot.protocols.length - board.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
