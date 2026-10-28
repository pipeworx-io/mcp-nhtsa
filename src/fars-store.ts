/**
 * D1 reads for the FARS fatal-crash tables added to the nhtsa pack (fleet #2972).
 *
 * Data: NHTSA Fatality Analysis Reporting System (FARS), annual National CSV
 * bulk files (static.nhtsa.gov/nhtsa/downloads/FARS/<YYYY>/National/). US
 * federal government work -- public domain (17 U.S.C. §105). FARS's live
 * CrashAPI (crashviewer.nhtsa.dot.gov) returned an Akamai 403 to every probe
 * on 2026-10-12, so this pack loads the annual bulk files ahead of time (CLAUDE.md "BUILD THE COPY")
 * into D1 by scripts/nhtsa-fars/load-data.mjs -- never by a deploy. See
 * mcps/nhtsa/README.md "FARS data".
 */

export interface D1Like {
  prepare(sql: string): D1StmtLike;
}
export interface D1StmtLike {
  bind(...values: unknown[]): D1StmtLike;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export class FarsStoreUnavailableError extends Error {
  constructor() {
    super(
      'nhtsa: the FARS fatal-crash store is not bound in this runtime (no _d1). This tool only answers through the Pipeworx gateway; a standalone install has no data to read.',
    );
    this.name = 'FarsStoreUnavailableError';
  }
}
export function requireFarsDb(d1: unknown): D1Like {
  if (!d1 || typeof (d1 as D1Like).prepare !== 'function') throw new FarsStoreUnavailableError();
  return d1 as D1Like;
}

export const FARS_SOURCE = {
  source: 'NHTSA Fatality Analysis Reporting System (FARS), annual National CSV files',
  source_url: 'https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars',
  license: 'US federal government work -- public domain (17 U.S.C. §105)',
};

// 2-letter postal code -> full state name used by this pack's loaded data
// (FARS's own STATENAME values, e.g. "Texas", "District of Columbia").
const STATE_ABBR: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico',
};

/** Resolve caller input (full name, 2-letter abbreviation, or FIPS code) to a
 *  candidate state name/FIPS pair. Does NOT guarantee the state is actually
 *  loaded -- call validState() for that. Returns null only on unparseable input. */
export function resolveState(input: unknown): { byName: string | null; byFips: number | null } | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (/^\d{1,2}$/.test(raw)) return { byName: null, byFips: Number(raw) };
  const upper = raw.toUpperCase();
  if (STATE_ABBR[upper]) return { byName: STATE_ABBR[upper], byFips: null };
  return { byName: raw, byFips: null };
}

export async function lookupState(db: D1Like, resolved: { byName: string | null; byFips: number | null }): Promise<{ state_fips: number; state_name: string } | null> {
  if (resolved.byFips != null) {
    const r = await db.prepare('SELECT state_fips, state_name FROM fars_state_month WHERE state_fips = ? LIMIT 1').bind(resolved.byFips).first<{ state_fips: number; state_name: string }>();
    return r ?? null;
  }
  if (resolved.byName) {
    const r = await db
      .prepare('SELECT state_fips, state_name FROM fars_state_month WHERE state_name = ? COLLATE NOCASE LIMIT 1')
      .bind(resolved.byName)
      .first<{ state_fips: number; state_name: string }>();
    return r ?? null;
  }
  return null;
}

export interface FarsMeta {
  loaded_at: string;
  earliest_year: number;
  latest_year: number;
  years_loaded: number[];
}
let cachedMeta: FarsMeta | null = null;
export async function getFarsMeta(db: D1Like): Promise<FarsMeta> {
  if (cachedMeta) return cachedMeta;
  const r = await db.prepare('SELECT key, value FROM fars_meta').all<{ key: string; value: string }>();
  const m = Object.fromEntries(r.results.map((row) => [row.key, row.value]));
  cachedMeta = {
    loaded_at: m.loaded_at ?? '',
    earliest_year: Number(m.earliest_year ?? 0),
    latest_year: Number(m.latest_year ?? 0),
    years_loaded: (m.years_loaded ?? '').split(',').filter(Boolean).map(Number),
  };
  return cachedMeta;
}

export interface StateMonthRow {
  year: number;
  month: number;
  state_fips: number;
  state_name: string;
  crashes: number;
  fatalities: number;
  persons_involved: number;
  vehicles_involved: number;
  pedestrians_involved: number;
}

/** Monthly rows for one state and (optionally) one year. Omitting year
 *  returns every loaded year/month for that state, most recent first. */
export async function stateMonths(db: D1Like, stateFips: number, year: number | null): Promise<StateMonthRow[]> {
  const where = ['state_fips = ?'];
  const params: unknown[] = [stateFips];
  if (year != null) {
    where.push('year = ?');
    params.push(year);
  }
  const sql = `SELECT year, month, state_fips, state_name, crashes, fatalities, persons_involved, vehicles_involved, pedestrians_involved
    FROM fars_state_month WHERE ${where.join(' AND ')}
    ORDER BY year DESC, month DESC`;
  const r = await db.prepare(sql).bind(...params).all<StateMonthRow>();
  return r.results;
}

/** All states for one year, summed across months -- for cross-state comparison. */
export async function allStatesForYear(db: D1Like, year: number, limit: number): Promise<Array<Omit<StateMonthRow, 'month'>>> {
  const sql = `SELECT year, state_fips, state_name,
      SUM(crashes) AS crashes, SUM(fatalities) AS fatalities,
      SUM(persons_involved) AS persons_involved, SUM(vehicles_involved) AS vehicles_involved,
      SUM(pedestrians_involved) AS pedestrians_involved
    FROM fars_state_month WHERE year = ?
    GROUP BY state_fips, state_name
    ORDER BY fatalities DESC
    LIMIT ?`;
  const r = await db.prepare(sql).bind(year, limit).all<Omit<StateMonthRow, 'month'>>();
  return r.results;
}

export interface MakeYearRow {
  year: number;
  make_name: string;
  vehicles_involved: number;
}

export async function vehicleMakesForYear(db: D1Like, year: number, limit: number): Promise<MakeYearRow[]> {
  const sql = `SELECT year, make_name, vehicles_involved FROM fars_vehicle_make_year WHERE year = ? ORDER BY vehicles_involved DESC LIMIT ?`;
  const r = await db.prepare(sql).bind(year, limit).all<MakeYearRow>();
  return r.results;
}

export async function vehicleMakeYears(db: D1Like, makeName: string): Promise<MakeYearRow[]> {
  const sql = `SELECT year, make_name, vehicles_involved FROM fars_vehicle_make_year WHERE make_name = ? COLLATE NOCASE ORDER BY year DESC`;
  const r = await db.prepare(sql).bind(makeName).all<MakeYearRow>();
  return r.results;
}

/** Distinct make names actually loaded (for a "did you mean" / discovery hint). */
export async function listMakes(db: D1Like, limit = 80): Promise<string[]> {
  const r = await db.prepare('SELECT DISTINCT make_name FROM fars_vehicle_make_year ORDER BY make_name LIMIT ?').bind(limit).all<{ make_name: string }>();
  return r.results.map((row) => row.make_name);
}
