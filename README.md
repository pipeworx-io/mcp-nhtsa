# NHTSA — National Highway Traffic Safety Administration

The U.S. Department of Transportation's NHTSA. Vehicle recalls, complaints, investigations, crash test ratings (NCAP), safety standards, VIN decoder, fatal-crash statistics (FARS), and fuel-economy ratings. The authoritative source for "is this car safe?" and "how much gas does it use?" Free, no auth.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1856+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Why this matters for AI agents

For automotive research — buying a used car, evaluating recall exposure, analyzing fleet safety, doing IP / patent due diligence on vehicle technology, or researching traffic-safety policy — NHTSA (plus DOE/EPA's fueleconomy.gov) is the canonical source. Pair with [USPTO patents](/docs/reference/patents) for vehicle-tech IP and [Federal Register](/docs/reference/federal-register) for proposed automotive rules.

Common flows:

- **Recall lookup.** "Is this VIN affected by any recall?" → VIN-based recall query.
- **Make/model/year recalls.** "Recalls for 2020 Tesla Model 3?" → recall search by vehicle.
- **Consumer complaints.** "Complaints about brake issues on Honda Civic?" → complaint search by make/model.
- **VIN decoder.** "What does VIN 1HGBH41JXMN109186 tell me?" → year, make, model, engine, manufacturer details.
- **Crash test ratings.** NCAP star ratings for vehicles.
- **Fatal-crash statistics.** "How many traffic fatalities did Texas have in 2023?" → state-level FARS aggregates.
- **Fuel economy.** "What's the combined MPG for a 2024 Toyota Camry?" → fueleconomy.gov lookup.

## Auth

None. NHTSA's and fueleconomy.gov's APIs are fully public, free, keyless.

## Datasets

| Dataset | What it is |
|---|---|
| **Recalls** | Manufacturer recalls + investigations |
| **Complaints** | Consumer complaints by VIN/make/model |
| **Investigations** | Open NHTSA defect investigations |
| **NCAP Crash Test** | Star ratings, frontal/side/rollover scores |
| **VIN Decoder** | Decode VIN to make/model/year + manufacturer specs |
| **TSBs** (Technical Service Bulletins) | Manufacturer service guidance |
| **FARS** (Fatality Analysis Reporting System) | Fatal motor-vehicle crash counts, fatalities, persons/vehicles/pedestrians involved, by state/month; vehicle makes involved in fatal crashes, by year |
| **Fuel Economy** (fueleconomy.gov, DOE/EPA) | City/highway/combined MPG, CO2 g/mile, fuel type, by model year + make + model |

## FARS data (fleet #2972)

NHTSA's live crash-query API returned an Akamai 403 to every probe tried on 2026-10-12, including with browser-like headers. NHTSA separately publishes FARS as annual bulk files, US federal government work and public domain, so `fars_state_fatalities`, `fars_vehicle_makes`, and `fars_coverage` are backed by those files loaded ahead of time rather than a live proxy, per CLAUDE.md "BUILD THE COPY".

- **What's loaded:** `scripts/nhtsa-fars/load-data.mjs` aggregates each year's crash-level file into `fars_state_month` (state × year × month: crashes, fatalities, persons/vehicles/pedestrians involved) and the vehicle-level file into `fars_vehicle_make_year` (make × year, national: count of vehicles of that make involved in a fatal crash — an involvement count, not a causation claim). Raw crash/vehicle rows are never stored. Call `fars_coverage` for the exact years loaded.
- **Refresh:** re-run `node scripts/nhtsa-fars/load-data.mjs --years 2022,2023,2024,2025` (add the newest published year; `--db`/`--config` override the defaults) once NHTSA publishes a new annual file — usually with roughly a one-year lag. Needs `wrangler` authenticated to the Pipeworx Cloudflare account (`CLOUDFLARE_ACCOUNT_ID` env var if the account has more than one in non-interactive mode).
- **Known gap:** no county/city granularity and no driver/vehicle-level detail (BAC, injury severity, road conditions) — those live in FARS's other per-record files, not aggregated here. File a follow-up if a caller needs them.

## fueleconomy.gov (live proxy)

`fuel_economy_mpg` and `fuel_economy_models` call the DOE/EPA fueleconomy.gov vehicle data service live, per request — it's a keyless REST API with no bulk download, so there is nothing to copy. A model year + make can have several engine/transmission/drivetrain *variants* under one model string (e.g. several Camry trims); `fuel_economy_mpg` returns up to 5. Pass the model string exactly as fueleconomy.gov lists it — `fuel_economy_models` shows the valid strings for a year + make when unsure.

## Common pitfalls

- **Recall vs. investigation vs. complaint.** Different severity levels: complaints (raw consumer reports), investigations (NHTSA-opened formal review), recalls (manufacturer-required fix). Don't conflate. Investigations sometimes lead to recalls but often don't.
- **Recall completion rates.** A recall doesn't mean every affected vehicle has been fixed. Many recalled vehicles never make it to a dealer for the fix. The recall remains "open" indefinitely for the unfixed vehicles.
- **Investigation phases.** PE (Preliminary Evaluation), EA (Engineering Analysis), DSI (Defect Investigation), each with different stakes. EA is the meaningful escalation; PE often closes without action.
- **Complaint counts ≠ defect rates.** Some defects produce many complaints; others produce few because they're catastrophic (drivers can't complain post-mortem). Cross-reference with crash data when relevant.
- **VIN decoder limitations.** The free VIN decoder gives factory-spec data but doesn't reflect aftermarket modifications, accident history, or current ownership. For those, you need commercial sources (Carfax, AutoCheck).
- **NCAP scoring evolved.** The 5-star scale changed in 2011 — earlier ratings aren't directly comparable to newer ones. Don't compare a 2008 5-star to a 2024 5-star.
- **FARS counts FATAL crashes only.** It is not a general crash database — non-fatal crashes (the overwhelming majority) aren't in here. For general crash/injury data, FARS isn't the right source.
- **`fars_vehicle_makes` is an involvement count, not a risk rate.** More Ford/Chevrolet/Toyota vehicles show up because those makes have far more vehicles on the road, not because they're less safe. Normalize by registrations/miles-driven before drawing a safety conclusion.
- **`fuel_economy_mpg`'s model string must match fueleconomy.gov's own listing.** "F-150" alone won't match; it's "F150 Pickup 2WD" / "F150 Pickup 4WD" etc. Call `fuel_economy_models` first if unsure.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "nhtsa": {
      "url": "https://gateway.pipeworx.io/nhtsa/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/nhtsa/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1856+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/decode_vin \
  -H 'Content-Type: application/json' \
  -d '{"vin":"1HGBH41JXMN109186"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/decode_vin`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-nhtsa` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/nhtsa/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "nhtsa": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-nhtsa"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Nhtsa data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
