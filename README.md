# mcp-nhtsa

NHTSA MCP — wraps the NHTSA vPIC (Vehicle Product Information Catalog) API (free, no auth)

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 250+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `get_makes` | Get all vehicle brands for a model year. Returns make names and IDs. E.g., year \'2023\'. |
| `get_models` | Get all vehicle models for a make and year. Returns model names and IDs. E.g., make \'Toyota\', year \'2023\'. |

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

Or connect to the full Pipeworx gateway for access to all 250+ data sources:

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

- [All tools and guides](https://github.com/pipeworx-io/examples)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
