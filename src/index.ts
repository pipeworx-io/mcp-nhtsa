interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}${responseHints(res)}`,
    res.url,
    res.status,
  );
}

/**
 * Facts about a FAILED response that live in its headers, not its body, appended
 * so the gateway's classifier (which only ever sees this string) can tell a limit
 * from a wall from a refusal (fleet #3477). Both are standard, both are absent on
 * almost every response, and neither is invented: `Retry-After` is the server
 * saying "come back later" (the one thing that makes a 403 a throttle), and
 * Cloudflare marks a bot challenge with `cf-mitigated: challenge`.
 */
function responseHints(res: Response): string {
  const hints: string[] = [];
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) hints.push(`retry-after: ${retryAfter.slice(0, 40)}`);
  if ((res.headers.get('cf-mitigated') ?? '').toLowerCase() === 'challenge') hints.push('Cloudflare bot challenge (cf-mitigated: challenge)');
  return hints.length ? ` (${hints.join('; ')})` : '';
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    // Fleet #2382. Everything that isn't a timeout/abort here is a genuine
    // NETWORK-LEVEL failure — DNS resolution, connection refused, TLS handshake,
    // Cloudflare's own "Network connection lost." — meaning `fetch()` itself
    // threw and no HTTP response of any kind was ever received. Until this fix
    // that raw exception was rethrown VERBATIM: a bare `TypeError: fetch failed`
    // (or the Workers-runtime equivalent) names no upstream, carries no class
    // token, and reads exactly like a defect in OUR code — because it says
    // nothing about the call at all. It landed in `error`, the tier that means
    // "Pipeworx has a defect", for every one of the (at the time of writing)
    // ~470 packs that call this helper directly with no wrapper of their own.
    //
    // `dexscreener` hit this independently (fleet #1579) and fixed it with a
    // bespoke per-pack try/catch around `fetchWithTimeout`. That fix is correct
    // but only covers one pack; every other caller of this shared helper still
    // leaked the raw exception. Moving the same fix HERE — the one place that
    // already carries the timeout case — covers every pack that uses
    // `fetchWithTimeout` without a wrapper, for free, and without widening
    // `classifyToolError`'s regex list: the fix is giving the message a proper
    // `upstream_down:` token at the point the two facts (no response was ever
    // received, and which host we were trying to reach) are actually in hand,
    // not teaching the classifier to guess from prose after the fact.
    //
    // Safe on the same grounds as the timeout branch above: no argument a
    // caller passes can make `fetch()` itself throw a connection-level error,
    // so this is always an availability failure, never a caller mistake. Same
    // `markInternalOrigin` treatment — an origin we run that never answered is
    // still ours, not a third party's outage.
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(
      markInternalOrigin(
        `upstream_down: could not reach ${name} at all (${raw.slice(0, 160)}). ` +
          `No request reached ${name}, so this says NOTHING about whether the arguments you passed ` +
          'are valid — do not re-check them on the strength of this error. Retry shortly.',
        url,
      ),
    );
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ── Bounded readers — peak memory, not just wall time (fleet #3322) ──────
//
// `parseJson` above does `await res.text()` then `JSON.parse(raw)`, so a
// multi-megabyte upstream body is held TWICE at peak: once as the raw string
// and once as the object graph (which for an array of small objects runs
// several times the byte size). Nothing in `workers/gateway` can see that
// peak — it happens inside the pack, before any gateway code holds a payload —
// which is why the gateway-side payload caps of #3293 and #3320 did not move
// the 503/1102 rate at all.
//
// Measured on the live gateway, 2026-10-19, sha fa5de5c34, direct tools/call:
//   statcan_list_cubes  8,049,566 B   <- one upstream array, no limit argument
//   gnomad_gene BRCA1   2,732,706 B
// Five of those in flight at the quality runner's width is ~40 MB of parse
// peak against a 128 MB isolate; Cloudflare kills the isolate and every
// request in flight returns 503/1102, which is why the victims look random.
//
// `readJsonArrayPrefix` is the fix for the dominant shape: an upstream that
// returns one enormous top-level JSON array with no server-side paging. It
// parses elements off the stream and DISCARDS the consumed bytes, so peak
// retained memory is one element plus one chunk rather than the whole body,
// and it cancels the body as soon as it has what it was asked for.

/** Default ceiling for a single upstream JSON body read into an isolate.
 *  Chosen so the known tail (statcan 8.0 MB, gnomad 2.7 MB) is bounded well
 *  below the point where a handful of concurrent reads exhausts 128 MB. */
const DEFAULT_MAX_JSON_BYTES = 1_500_000;

interface JsonArrayPrefix<T> {
  /** The decoded elements, at most `maxItems` of them. */
  items: T[];
  /** True when the upstream array had more elements than we read. */
  truncated: boolean;
  /** Bytes actually pulled off the socket — the number that bounds memory. */
  bytesRead: number;
  /** `Content-Length` if the upstream declared one, else null. */
  declaredBytes: number | null;
}

/**
 * Read the FIRST `maxItems` elements of a top-level JSON array off a response
 * stream without ever materialising the whole body.
 *
 * Use this instead of `parseJson` when the upstream returns one big array and
 * offers no `limit`/`offset` of its own. Peak retained memory is one element
 * plus the current chunk; the body is cancelled as soon as `maxItems` is
 * reached, so the remaining megabytes are never transferred at all.
 *
 *     const { items, truncated } = await readJsonArrayPrefix<Cube>(
 *       res, 'StatCan WDS', { maxItems: limit + offset });
 *
 * `maxBytes` is a second, independent backstop for a pathological element (a
 * single 50 MB object): hitting it stops the read and sets `truncated`, rather
 * than throwing, because a partial answer plus an explicit truncated flag is
 * more useful to a caller than an error.
 */
async function readJsonArrayPrefix<T>(
  res: Response,
  name: string,
  opts: { maxItems: number; maxBytes?: number },
): Promise<JsonArrayPrefix<T>> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
  const declaredRaw = Number(res.headers.get('content-length'));
  const declaredBytes = Number.isFinite(declaredRaw) && declaredRaw > 0 ? declaredRaw : null;

  // No streaming body available (a mock, or an already-buffered response):
  // fall back to the whole-text path so behaviour stays correct, just unbounded.
  if (!res.body) {
    const all = await parseJson<T[]>(res, name);
    if (!Array.isArray(all)) throw new Error(`upstream_down: ${name} returned ${typeof all} where a JSON array was expected.`);
    return {
      items: all.slice(0, opts.maxItems),
      truncated: all.length > opts.maxItems,
      bytesRead: declaredBytes ?? 0,
      declaredBytes,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const items: T[] = [];

  let buf = '';
  let scan = 0;
  let bytesRead = 0;
  let started = false; // consumed the opening '['
  let arrayEnded = false;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let elemStart = -1;
  let truncated = false;

  const push = (text: string) => {
    const t = text.trim();
    if (!t) return;
    items.push(JSON.parse(t) as T);
  };

  try {
    outer: while (items.length < opts.maxItems && !arrayEnded) {
      const { value, done } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      buf += decoder.decode(value, { stream: true });
      if (bytesRead > maxBytes) { truncated = true; break; }

      for (; scan < buf.length; scan++) {
        const ch = buf[scan];

        if (inStr) {
          if (esc) { esc = false; continue; }
          if (ch === '\\') { esc = true; continue; }
          if (ch === '"') inStr = false;
          continue;
        }

        if (!started) {
          if (ch === '[') { started = true; continue; }
          if (ch.trim() === '') continue;
          throw new Error(
            `upstream_down: ${name} returned a body that does not begin with a JSON array (saw ${JSON.stringify(ch)}). ` +
              'This reader is only for upstreams that answer with one top-level array.',
          );
        }

        if (ch === '"') { if (depth === 0 && elemStart < 0) elemStart = scan; inStr = true; continue; }

        if (ch === '{' || ch === '[') {
          if (depth === 0 && elemStart < 0) elemStart = scan;
          depth++;
          continue;
        }

        if (ch === '}' || ch === ']') {
          if (depth > 0) {
            depth--;
            if (depth === 0 && elemStart >= 0) {
              push(buf.slice(elemStart, scan + 1));
              elemStart = -1;
              if (items.length >= opts.maxItems) { truncated = true; scan++; break outer; }
            }
            continue;
          }
          // depth 0 and a closing bracket: the end of the top-level array.
          if (elemStart >= 0) { push(buf.slice(elemStart, scan)); elemStart = -1; }
          arrayEnded = true;
          break outer;
        }

        if (ch === ',' && depth === 0) {
          if (elemStart >= 0) {
            push(buf.slice(elemStart, scan));
            elemStart = -1;
            if (items.length >= opts.maxItems) { truncated = true; scan++; break outer; }
          }
          continue;
        }

        // A bare scalar element (number / true / false / null).
        if (depth === 0 && elemStart < 0 && ch.trim() !== '') elemStart = scan;
      }

      // Drop everything already consumed. THIS is what bounds memory: without
      // it `buf` grows to the full body and the reader is streaming in name only.
      if (elemStart >= 0) {
        buf = buf.slice(elemStart);
        scan -= elemStart;
        elemStart = 0;
      } else {
        buf = buf.slice(scan);
        scan = 0;
      }
    }
  } finally {
    // Cancel rather than drain: the point is that the remaining megabytes are
    // never transferred. A cancel on an already-finished body is a no-op.
    await reader.cancel().catch(() => {});
  }

  return { items, truncated, bytesRead, declaredBytes };
}

/**
 * `parseJson`, with a hard ceiling on how many bytes are read.
 *
 * For an upstream whose body is not a single array (so `readJsonArrayPrefix`
 * does not apply) but which can still answer with megabytes. Unlike the array
 * reader this one THROWS when the cap is hit, because a truncated prefix of an
 * arbitrary JSON document is not parseable and there is no partial answer to
 * hand back. A declared `Content-Length` over the cap is refused before a
 * single chunk is read.
 */
async function parseJsonBounded<T>(
  res: Response,
  name: string,
  maxBytes: number = DEFAULT_MAX_JSON_BYTES,
): Promise<T> {
  const declaredRaw = Number(res.headers.get('content-length'));
  const declared = Number.isFinite(declaredRaw) && declaredRaw > 0 ? declaredRaw : null;

  const tooBig = (n: number) =>
    new Error(
      `upstream_down: ${name} answered with ${n.toLocaleString()} bytes, over this pack's ${maxBytes.toLocaleString()}-byte ceiling. ` +
        'The body is not read past the ceiling on purpose — a few concurrent reads of a body that size exhaust the ' +
        'Worker isolate and take every other in-flight request down with them. Narrow the request (a smaller range, ' +
        'a specific id, or a lower limit) and retry.',
    );

  if (declared !== null && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw tooBig(declared);
  }
  if (!res.body) return parseJson<T>(res, name);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let bytesRead = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) throw tooBig(bytesRead);
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected. ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON. ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}
/**
 * NHTSA MCP — wraps the NHTSA vPIC (Vehicle Product Information Catalog) API (free, no auth),
 * NHTSA's Fatality Analysis Reporting System (FARS) fatal-crash data, and
 * fueleconomy.gov vehicle MPG (fleet #2972).
 *
 * Tools:
 * - decode_vin: decode a Vehicle Identification Number into make, model, year, and attributes
 * - get_makes: retrieve all vehicle makes registered with NHTSA
 * - get_models: retrieve all models for a given make and model year
 * - get_recalls / get_complaints / get_safety_ratings: live NHTSA safety data
 * - fars_state_fatalities / fars_vehicle_makes / fars_coverage: FARS fatal-crash
 *   aggregates, loaded ahead of time into D1 (CrashAPI 403s on every probe; see
 *   fars-store.ts and README.md "FARS data")
 * - fuel_economy_mpg / fuel_economy_models: live fueleconomy.gov MPG lookups
 */

import {
  allStatesForYear,
  FARS_SOURCE,
  getFarsMeta,
  listMakes,
  lookupState,
  requireFarsDb,
  resolveState,
  stateMonths,
  vehicleMakesForYear,
  vehicleMakeYears,
  type D1Like,
} from './fars-store.js';
import { FE_SOURCE, menuModels, menuOptions, vehicleById } from './fuel-economy.js';

// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'NHTSA');
}

const BASE_URL = 'https://vpic.nhtsa.dot.gov/api';
const SAFETY_BASE = 'https://api.nhtsa.gov';

const tools: McpToolExport['tools'] = [
  {
    name: 'decode_vin',
    description:
      'Decode a VIN to get vehicle details. Returns make, model, year, body style, engine type, drivetrain, and plant. E.g., \'1HGBH41JXMN109186\'. (For recalls/ratings use get_recalls / get_safety_ratings.)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        vin: {
          type: 'string',
          description: '17-character VIN (e.g., "1HGBH41JXMN109186")',
        },
      },
      required: ['vin'],
    },
  },
  {
    name: 'get_makes',
    description: 'Get all vehicle brands for a model year. Returns make names and IDs. E.g., year \'2023\'.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_models',
    description: 'Get all vehicle models for a make and year. Returns model names and IDs. E.g., make \'Toyota\', year \'2023\'.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        make: { type: 'string', description: 'Vehicle make name (e.g., "Toyota", "Ford", "BMW")' },
        year: { type: 'number', description: 'Model year (e.g., 2022)' },
      },
      required: ['make', 'year'],
    },
  },
  {
    name: 'get_recalls',
    description:
      'Get official NHTSA safety RECALLS for a vehicle. PREFER OVER WEB SEARCH for "is my car recalled", "recalls on a 2021 Honda Civic", "open recalls for make/model/year". Returns each recall: component, summary, safety consequence, remedy, NHTSA campaign number, and report date. Pass make + model + model_year.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        make: { type: 'string', description: 'Vehicle make (e.g., "Honda")' },
        model: { type: 'string', description: 'Vehicle model (e.g., "Civic")' },
        model_year: { type: 'number', description: 'Model year (e.g., 2021)' },
      },
      required: ['make', 'model', 'model_year'],
    },
  },
  {
    name: 'get_complaints',
    description:
      'Get owner-filed NHTSA complaints for a vehicle — real-world problems drivers reported (vs official recalls). Use for "common problems with a 2020 Ford Explorer", "what are owners complaining about". Returns components, summary, crash/fire flags, injuries/deaths, and filing date. Pass make + model + model_year.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        make: { type: 'string', description: 'Vehicle make (e.g., "Ford")' },
        model: { type: 'string', description: 'Vehicle model (e.g., "Explorer")' },
        model_year: { type: 'number', description: 'Model year (e.g., 2020)' },
      },
      required: ['make', 'model', 'model_year'],
    },
  },
  {
    name: 'get_safety_ratings',
    description:
      'Get NHTSA 5-Star Safety Ratings (NCAP crash-test results) for a vehicle — overall, frontal, side, and rollover star ratings. Use for "crash test rating for a 2021 Honda Civic", "how safe is X". Pass make + model + model_year.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        make: { type: 'string', description: 'Vehicle make (e.g., "Honda")' },
        model: { type: 'string', description: 'Vehicle model (e.g., "Civic")' },
        model_year: { type: 'number', description: 'Model year (e.g., 2021)' },
      },
      required: ['make', 'model', 'model_year'],
    },
  },
  {
    name: 'fars_state_fatalities',
    description:
      'Fatal motor-vehicle crash counts and fatalities for a US state, from NHTSA\'s Fatality Analysis Reporting System (FARS). Pass a state (full name like "Texas", 2-letter postal code like "TX", or FIPS code) and a year. Returns monthly rows: crashes, fatalities, persons involved, vehicles involved, pedestrians involved. Omit year to get every loaded year/month for that state. Covers a recent multi-year window (see data_as_of and call fars_coverage for the exact range), not full FARS history. Unknown states are refused with a clear error, never an empty success.',
    summary: 'Monthly fatal-crash counts and fatalities for one US state.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        state: { type: 'string', description: 'State name ("Texas"), 2-letter postal code ("TX"), or FIPS code ("48").' },
        year: { type: 'number', description: 'Optional: calendar year, e.g. 2023. Omit to return every loaded year for this state.' },
      },
      required: ['state'],
    },
  },
  {
    name: 'fars_vehicle_makes',
    description:
      'Vehicle makes involved in fatal crashes nationwide for a given year, from NHTSA FARS. Pass year alone to get the top makes ranked by vehicle-involvement count (e.g. "which vehicle makes show up most in fatal crashes in 2023"); pass make as well to get that one make\'s involvement count across every loaded year. This is an INVOLVEMENT count, not a claim that the make caused the crash. Unknown makes are refused with a clear error naming a few valid makes, never an empty success.',
    summary: 'Vehicle makes involved in fatal crashes, ranked or looked up by name.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        year: { type: 'number', description: 'Calendar year, e.g. 2023. Required unless make is given (then optional, scoping to one year).' },
        make: { type: 'string', description: 'Optional: vehicle make, e.g. "Toyota", "Ford", "Harley-Davidson".' },
        limit: { type: 'number', description: 'Max makes to return when ranking by year. Default 20, max 50.' },
      },
      required: [],
    },
  },
  {
    name: 'fars_coverage',
    description: 'What FARS fatal-crash data this pack actually has loaded right now: the earliest and latest year covered and when it was last loaded. Call this before fars_state_fatalities/fars_vehicle_makes if unsure a given year is covered.',
    summary: 'Earliest/latest FARS year loaded, and when.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'fuel_economy_mpg',
    description:
      'EPA fuel-economy ratings (city/highway/combined MPG, CO2 g/mile, fuel type) for a specific model year + make + model, from fueleconomy.gov (DOE/EPA), proxied live. Pass the model string exactly as fueleconomy.gov lists it (e.g. "Camry", "F-150 2WD", "Model 3") -- if unsure, call fuel_economy_models first to see valid model strings for that year+make. A model year/make/model can have several engine/transmission/drivetrain VARIANTS; this returns up to 5, each with its own MPG. Unknown make/model/year combos are refused with a clear error (never an empty success) and, when the make or model itself is not recognized for that year, list a few valid options.',
    summary: 'EPA city/highway/combined MPG and CO2 for a model year + make + model.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        year: { type: 'number', description: 'Model year, e.g. 2024.' },
        make: { type: 'string', description: 'Vehicle make, e.g. "Toyota".' },
        model: { type: 'string', description: 'Vehicle model exactly as fueleconomy.gov lists it, e.g. "Camry". Call fuel_economy_models to see valid strings.' },
      },
      required: ['year', 'make', 'model'],
    },
  },
  {
    name: 'fuel_economy_models',
    description: 'List the exact model strings fueleconomy.gov recognizes for a given model year + make (e.g. year 2024, make "Toyota" -> "Camry", "Camry Hybrid LE", "RAV4 AWD", ...). Call this before fuel_economy_mpg when you are not sure of the exact model string, or when fuel_economy_mpg refuses a model as unrecognized.',
    summary: 'Valid fueleconomy.gov model strings for a model year + make.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        year: { type: 'number', description: 'Model year, e.g. 2024.' },
        make: { type: 'string', description: 'Vehicle make, e.g. "Toyota".' },
      },
      required: ['year', 'make'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'decode_vin':
      return decodeVin(args.vin as string);
    case 'get_makes':
      return getMakes();
    case 'get_models':
      return getModels(args.make as string, args.year as number);
    case 'get_recalls':
      return getRecalls(args.make as string, args.model as string, args.model_year as number);
    case 'get_complaints':
      return getComplaints(args.make as string, args.model as string, args.model_year as number);
    case 'get_safety_ratings':
      return getSafetyRatings(args.make as string, args.model as string, args.model_year as number);
    case 'fars_state_fatalities':
      return farsStateFatalities(requireFarsDb(args._d1), args);
    case 'fars_vehicle_makes':
      return farsVehicleMakes(requireFarsDb(args._d1), args);
    case 'fars_coverage':
      return farsCoverage(requireFarsDb(args._d1));
    case 'fuel_economy_mpg':
      return fuelEconomyMpg(args);
    case 'fuel_economy_models':
      return fuelEconomyModels(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── FARS fatal-crash tools (D1, loaded ahead of time) ──────────────────────

async function farsStateFatalities(db: D1Like, args: Record<string, unknown>) {
  const meta = await getFarsMeta(db);
  const resolved = resolveState(args.state);
  if (!resolved) {
    return { found: false, reason: 'invalid_state', message: `${JSON.stringify(args.state)} is not a recognizable state (give a full name, 2-letter postal code, or FIPS code).`, data_as_of: meta.latest_year };
  }
  const match = await lookupState(db, resolved);
  if (!match) {
    return {
      found: false,
      reason: 'unknown_state',
      message: `${JSON.stringify(args.state)} is not a recognized US state in this pack's loaded FARS data. Use a full state name ("Texas"), 2-letter postal code ("TX"), or FIPS code.`,
      data_as_of: meta.latest_year,
    };
  }
  const year = args.year != null && args.year !== '' ? Math.floor(Number(args.year)) : null;
  if (args.year != null && args.year !== '' && !Number.isFinite(year)) {
    return { found: false, reason: 'invalid_year', message: `year must be a valid number (got ${JSON.stringify(args.year)}).`, data_as_of: meta.latest_year };
  }
  const rows = await stateMonths(db, match.state_fips, year);
  if (!rows.length) {
    return {
      found: false,
      reason: 'no_data',
      state: match.state_name,
      year,
      message: `No FARS data for ${match.state_name}${year ? ` in ${year}` : ''} in the loaded window (${meta.earliest_year}-${meta.latest_year}).`,
      coverage: { earliest_year: meta.earliest_year, latest_year: meta.latest_year },
      ...FARS_SOURCE,
      data_as_of: meta.latest_year,
    };
  }
  const totalFatalities = rows.reduce((s, r) => s + r.fatalities, 0);
  const totalCrashes = rows.reduce((s, r) => s + r.crashes, 0);
  return {
    found: true,
    state: match.state_name,
    state_fips: match.state_fips,
    year,
    total_crashes: totalCrashes,
    total_fatalities: totalFatalities,
    returned_months: rows.length,
    coverage: { earliest_year: meta.earliest_year, latest_year: meta.latest_year },
    months: rows,
    ...FARS_SOURCE,
    data_as_of: year ?? meta.latest_year,
  };
}

async function farsVehicleMakes(db: D1Like, args: Record<string, unknown>) {
  const meta = await getFarsMeta(db);
  const makeArg = args.make != null && args.make !== '' ? String(args.make).trim() : null;

  if (makeArg) {
    const rows = await vehicleMakeYears(db, makeArg);
    const year = args.year != null && args.year !== '' ? Math.floor(Number(args.year)) : null;
    const filtered = year != null ? rows.filter((r) => r.year === year) : rows;
    if (!rows.length) {
      const sample = await listMakes(db, 15);
      return {
        found: false,
        reason: 'unknown_make',
        message: `${JSON.stringify(args.make)} is not a recognized vehicle make in this pack's loaded FARS data. A few makes that ARE loaded: ${sample.join(', ')}.`,
        data_as_of: meta.latest_year,
      };
    }
    if (!filtered.length) {
      return {
        found: false,
        reason: 'no_data',
        make: makeArg,
        year,
        message: `${makeArg} is a recognized make, but has no data for year ${year} in the loaded window (${meta.earliest_year}-${meta.latest_year}).`,
        coverage: { earliest_year: meta.earliest_year, latest_year: meta.latest_year },
        ...FARS_SOURCE,
        data_as_of: meta.latest_year,
      };
    }
    return {
      found: true,
      make: filtered[0].make_name,
      years: filtered,
      coverage: { earliest_year: meta.earliest_year, latest_year: meta.latest_year },
      ...FARS_SOURCE,
      data_as_of: meta.latest_year,
    };
  }

  const year = args.year != null && args.year !== '' ? Math.floor(Number(args.year)) : null;
  if (year == null || !Number.isFinite(year)) {
    return { found: false, reason: 'missing_year', message: 'Pass year to rank makes for a year, or make to look up one make across years.', data_as_of: meta.latest_year };
  }
  const limit = Math.min(Math.max(1, Math.floor(Number(args.limit) || 20)), 50);
  const rows = await vehicleMakesForYear(db, year, limit);
  if (!rows.length) {
    return {
      found: false,
      reason: 'no_data',
      year,
      message: `No vehicle-make data for year ${year} in the loaded window (${meta.earliest_year}-${meta.latest_year}).`,
      coverage: { earliest_year: meta.earliest_year, latest_year: meta.latest_year },
      ...FARS_SOURCE,
      data_as_of: meta.latest_year,
    };
  }
  return {
    found: true,
    year,
    returned: rows.length,
    note: 'vehicles_involved counts vehicles of this make present in a fatal crash that year -- not a claim the make caused the crash or its fatalities.',
    makes: rows,
    coverage: { earliest_year: meta.earliest_year, latest_year: meta.latest_year },
    ...FARS_SOURCE,
    data_as_of: meta.latest_year,
  };
}

async function farsCoverage(db: D1Like) {
  const meta = await getFarsMeta(db);
  return {
    earliest_year: meta.earliest_year,
    latest_year: meta.latest_year,
    years_loaded: meta.years_loaded,
    loaded_at: meta.loaded_at,
    note: 'Scoped to a recent multi-year window, not full FARS history (1975-present). Re-run the loader with a wider --years to extend further back.',
    ...FARS_SOURCE,
    data_as_of: meta.latest_year,
  };
}

// ── fueleconomy.gov tools (live proxy) ─────────────────────────────────────

function reqFuelEconomyArgs(args: Record<string, unknown>) {
  const year = Math.floor(Number(args.year));
  const make = args.make != null ? String(args.make).trim() : '';
  if (!Number.isFinite(year) || !make) {
    throw new Error('year and make are both required (e.g. year:2024, make:"Toyota").');
  }
  return { year, make };
}

async function fuelEconomyModels(args: Record<string, unknown>) {
  const { year, make } = reqFuelEconomyArgs(args);
  const models = await menuModels(year, make);
  if (!models.length) {
    throw new Error(`fueleconomy.gov has no models listed for make ${JSON.stringify(make)} in model year ${year} -- the make may be misspelled, or not sold that year. Try get_makes (NHTSA vPIC) to check spelling, or a nearby year.`);
  }
  return {
    found: true,
    year,
    make,
    returned: models.length,
    models: models.map((m) => m.text),
    ...FE_SOURCE,
    data_as_of: String(year),
  };
}

async function fuelEconomyMpg(args: Record<string, unknown>) {
  const { year, make } = reqFuelEconomyArgs(args);
  const model = args.model != null ? String(args.model).trim() : '';
  if (!model) throw new Error('model is required (e.g. model:"Camry"). Call fuel_economy_models to see valid strings for this year+make.');

  const options = await menuOptions(year, make, model);
  if (!options.length) {
    // Distinguish "bad make" from "bad model" so the refusal is actionable.
    const models = await menuModels(year, make);
    if (!models.length) {
      throw new Error(`fueleconomy.gov has no data for make ${JSON.stringify(make)} in model year ${year} -- the make may be misspelled or not sold that year.`);
    }
    const sample = models.slice(0, 15).map((m) => m.text);
    throw new Error(
      `fueleconomy.gov does not recognize model ${JSON.stringify(model)} for ${year} ${make}. Valid model strings for this year/make include: ${sample.join(', ')}${models.length > 15 ? ', ...' : ''}. Call fuel_economy_models for the full list.`,
    );
  }

  const variants = await Promise.all(options.slice(0, 5).map((opt) => vehicleById(opt.value)));
  if (!variants.length) {
    // menuOptions returned items but every vehicleById call failed to parse --
    // loud error, never a silent empty success (wave-1 lesson).
    throw new Error(`fueleconomy.gov listed ${options.length} variant(s) for ${year} ${make} ${model} but none could be resolved to MPG data. Upstream may be degraded; retry.`);
  }
  return {
    found: true,
    year,
    make,
    model,
    returned_variants: variants.length,
    variants: variants.map((v) => ({
      trim_id: v.id,
      transmission: v.trany,
      drive: v.drive,
      cylinders: v.cylinders,
      displacement_l: v.displ,
      vehicle_class: v.vclass,
      fuel_type: v.fuel_type,
      fuel_type_secondary: v.fuel_type2,
      city_mpg: v.city_mpg,
      highway_mpg: v.highway_mpg,
      combined_mpg: v.combined_mpg,
      combined_mpge_phev: v.phev_combined_mpge,
      co2_g_per_mile: v.co2_g_per_mile,
      start_stop: v.start_stop,
    })),
    ...FE_SOURCE,
    data_as_of: String(year),
  };
}

function reqVehicle(make: string, model: string, year: number) {
  if (!make || !model || !year) {
    throw new Error('make, model, and model_year are all required (e.g., make:"Honda", model:"Civic", model_year:2021).');
  }
}

async function getRecalls(make: string, model: string, modelYear: number) {
  reqVehicle(make, model, modelYear);
  const url = `${SAFETY_BASE}/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${modelYear}`;
  const res = await pwFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw await httpError(res, 'NHTSA recalls error');
  const data = (await res.json()) as { Count?: number; results?: Array<Record<string, unknown>> };
  return {
    make, model, model_year: modelYear,
    count: data.Count ?? (data.results?.length ?? 0),
    recalls: (data.results ?? []).map((r) => ({
      campaign_number: r.NHTSACampaignNumber ?? null,
      component: r.Component ?? null,
      summary: r.Summary ?? null,
      consequence: r.Consequence ?? null,
      remedy: r.Remedy ?? null,
      report_received_date: r.ReportReceivedDate ?? null,
      manufacturer: r.Manufacturer ?? null,
    })),
  };
}

async function getComplaints(make: string, model: string, modelYear: number) {
  reqVehicle(make, model, modelYear);
  const url = `${SAFETY_BASE}/complaints/complaintsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${modelYear}`;
  const res = await pwFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw await httpError(res, 'NHTSA complaints error');
  const data = (await res.json()) as { count?: number; results?: Array<Record<string, unknown>> };
  const results = data.results ?? [];
  return {
    make, model, model_year: modelYear,
    count: data.count ?? results.length,
    complaints: results.slice(0, 25).map((c) => ({
      odi_number: c.odiNumber ?? null,
      components: c.components ?? null,
      summary: c.summary ?? null,
      date_filed: c.dateComplaintFiled ?? null,
      crash: c.crash ?? null,
      fire: c.fire ?? null,
      injuries: c.numberOfInjuries ?? null,
      deaths: c.numberOfDeaths ?? null,
    })),
  };
}

async function getSafetyRatings(make: string, model: string, modelYear: number) {
  reqVehicle(make, model, modelYear);
  const lookupUrl = `${SAFETY_BASE}/SafetyRatings/modelyear/${modelYear}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`;
  const lookupRes = await pwFetch(lookupUrl, { headers: { Accept: 'application/json' } });
  if (!lookupRes.ok) throw await httpError(lookupRes, 'NHTSA safety ratings error');
  const lookup = (await lookupRes.json()) as { Count?: number; Results?: Array<{ VehicleId?: number; VehicleDescription?: string }> };
  const variants = (lookup.Results ?? []).filter((v) => v.VehicleId);
  if (variants.length === 0) {
    return { make, model, model_year: modelYear, count: 0, note: 'No NCAP crash-test ratings published for this make/model/year (not all vehicles are tested).', ratings: [] };
  }

  // Each VehicleId is a tested variant (body style/drivetrain). Resolve up to 5.
  const ratings = await Promise.all(
    variants.slice(0, 5).map(async (v) => {
      const r = await pwFetch(`${SAFETY_BASE}/SafetyRatings/VehicleId/${v.VehicleId}`, { headers: { Accept: 'application/json' } });
      const rd = ((await r.json()) as { Results?: Array<Record<string, unknown>> }).Results?.[0] ?? {};
      return {
        variant: v.VehicleDescription ?? null,
        overall: rd.OverallRating ?? null,
        frontal_crash: rd.OverallFrontCrashRating ?? null,
        side_crash: rd.OverallSideCrashRating ?? null,
        rollover: rd.RolloverRating ?? null,
      };
    }),
  );
  return { make, model, model_year: modelYear, count: ratings.length, ratings };
}

interface NhtsaResult {
  Variable?: string;
  Value?: string | null;
  ValueId?: string | null;
}

async function decodeVin(vin: string) {
  const res = await pwFetch(`${BASE_URL}/vehicles/DecodeVin/${encodeURIComponent(vin)}?format=json`);
  if (!res.ok) throw await httpError(res, 'NHTSA error');

  const data = (await res.json()) as { Results?: NhtsaResult[]; Message?: string };

  if (!data.Results || data.Results.length === 0) {
    throw new Error('No results returned for VIN');
  }

  // Collect all non-null, non-empty decoded fields
  const attributes: Record<string, string> = {};
  for (const r of data.Results) {
    if (r.Variable && r.Value && r.Value.trim() !== '' && r.Value !== 'Not Applicable') {
      attributes[r.Variable] = r.Value;
    }
  }

  // Pull out top-level fields for easy access
  return {
    vin: vin.toUpperCase(),
    make: attributes['Make'] ?? null,
    model: attributes['Model'] ?? null,
    model_year: attributes['Model Year'] ?? null,
    trim: attributes['Trim'] ?? null,
    vehicle_type: attributes['Vehicle Type'] ?? null,
    body_class: attributes['Body Class'] ?? null,
    doors: attributes['Doors'] ?? null,
    drive_type: attributes['Drive Type'] ?? null,
    fuel_type_primary: attributes['Fuel Type - Primary'] ?? null,
    engine_cylinders: attributes['Engine Number of Cylinders'] ?? null,
    engine_displacement_l: attributes['Displacement (L)'] ?? null,
    transmission: attributes['Transmission Style'] ?? null,
    plant_country: attributes['Plant Country'] ?? null,
    manufacturer: attributes['Manufacturer Name'] ?? null,
    all_attributes: attributes,
  };
}

async function getMakes() {
  const res = await pwFetch(`${BASE_URL}/vehicles/GetAllMakes?format=json`);
  if (!res.ok) throw await httpError(res, 'NHTSA error');

  const data = (await res.json()) as {
    Results?: { Make_ID?: number; Make_Name?: string }[];
    Count?: number;
  };

  return {
    count: data.Count ?? (data.Results?.length ?? 0),
    makes: (data.Results ?? []).map((m) => ({
      id: m.Make_ID ?? null,
      name: m.Make_Name ?? null,
    })),
  };
}

async function getModels(make: string, year: number) {
  const url = `${BASE_URL}/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`;
  const res = await pwFetch(url);
  if (!res.ok) throw await httpError(res, 'NHTSA error');

  const data = (await res.json()) as {
    Results?: { Make_ID?: number; Make_Name?: string; Model_ID?: number; Model_Name?: string }[];
    Count?: number;
  };

  return {
    make,
    year,
    count: data.Count ?? (data.Results?.length ?? 0),
    models: (data.Results ?? []).map((m) => ({
      make_id: m.Make_ID ?? null,
      make_name: m.Make_Name ?? null,
      model_id: m.Model_ID ?? null,
      model_name: m.Model_Name ?? null,
    })),
  };
}

export default { tools, callTool, meter: { credits: 5 } } satisfies McpToolExport;
