# NHTSA — National Highway Traffic Safety Administration

The U.S. Department of Transportation's NHTSA. Vehicle recalls, complaints, investigations, crash test ratings (NCAP), safety standards, VIN decoder. The authoritative source for "is this car safe?" Free, no auth.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1683+ live data sources.

## Why this matters for AI agents

For automotive research — buying a used car, evaluating recall exposure, analyzing fleet safety, doing IP / patent due diligence on vehicle technology — NHTSA is the canonical source. Pair with [USPTO patents](/docs/reference/patents) for vehicle-tech IP and [Federal Register](/docs/reference/federal-register) for proposed automotive rules.

Common flows:

- **Recall lookup.** "Is this VIN affected by any recall?" → VIN-based recall query.
- **Make/model/year recalls.** "Recalls for 2020 Tesla Model 3?" → recall search by vehicle.
- **Consumer complaints.** "Complaints about brake issues on Honda Civic?" → complaint search by make/model.
- **VIN decoder.** "What does VIN 1HGBH41JXMN109186 tell me?" → year, make, model, engine, manufacturer details.
- **Crash test ratings.** NCAP star ratings for vehicles.

## Auth

None. NHTSA's APIs are fully public, free.

## Datasets

| Dataset | What it is |
|---|---|
| **Recalls** | Manufacturer recalls + investigations |
| **Complaints** | Consumer complaints by VIN/make/model |
| **Investigations** | Open NHTSA defect investigations |
| **NCAP Crash Test** | Star ratings, frontal/side/rollover scores |
| **VIN Decoder** | Decode VIN to make/model/year + manufacturer specs |
| **TSBs** (Technical Service Bulletins) | Manufacturer service guidance |

## Common pitfalls

- **Recall vs. investigation vs. complaint.** Different severity levels: complaints (raw consumer reports), investigations (NHTSA-opened formal review), recalls (manufacturer-required fix). Don't conflate. Investigations sometimes lead to recalls but often don't.
- **Recall completion rates.** A recall doesn't mean every affected vehicle has been fixed. Many recalled vehicles never make it to a dealer for the fix. The recall remains "open" indefinitely for the unfixed vehicles.
- **Investigation phases.** PE (Preliminary Evaluation), EA (Engineering Analysis), DSI (Defect Investigation), each with different stakes. EA is the meaningful escalation; PE often closes without action.
- **Complaint counts ≠ defect rates.** Some defects produce many complaints; others produce few because they're catastrophic (drivers can't complain post-mortem). Cross-reference with crash data when relevant.
- **VIN decoder limitations.** The free VIN decoder gives factory-spec data but doesn't reflect aftermarket modifications, accident history, or current ownership. For those, you need commercial sources (Carfax, AutoCheck).
- **NCAP scoring evolved.** The 5-star scale changed in 2011 — earlier ratings aren't directly comparable to newer ones. Don't compare a 2008 5-star to a 2024 5-star.

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

Both URLs reach the same gateway and the same 1683+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/decode_vin \
  -H 'Content-Type: application/json' \
  -d '{"vin":"1HGBH41JXMN109186"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/decode_vin`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

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

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-nhtsa
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

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
