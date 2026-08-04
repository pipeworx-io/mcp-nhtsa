# NHTSA — National Highway Traffic Safety Administration

The U.S. Department of Transportation's NHTSA. Vehicle recalls, complaints, investigations, crash test ratings (NCAP), safety standards, VIN decoder. The authoritative source for "is this car safe?" Free, no auth.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Nhtsa data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
