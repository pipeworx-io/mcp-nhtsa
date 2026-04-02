# @pipeworx/mcp-nhtsa

MCP server for vehicle data via the [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/). Free, no authentication required.

## Tools

| Tool | Description |
|------|-------------|
| `decode_vin` | Decode a 17-character VIN to get make, model, year, body style, engine, and more |
| `get_makes` | Retrieve all vehicle makes (brands) registered with NHTSA |
| `get_models` | Get all vehicle models for a specific make and model year |

## Quickstart via Pipeworx Gateway

```bash
curl -X POST https://gateway.pipeworx.io/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "nhtsa__decode_vin",
      "arguments": { "vin": "1HGBH41JXMN109186" }
    },
    "id": 1
  }'
```

## License

MIT
