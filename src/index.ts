/**
 * NHTSA MCP — wraps the NHTSA vPIC (Vehicle Product Information Catalog) API (free, no auth)
 *
 * Tools:
 * - decode_vin: decode a Vehicle Identification Number into make, model, year, and attributes
 * - get_makes: retrieve all vehicle makes registered with NHTSA
 * - get_models: retrieve all models for a given make and model year
 */

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

const BASE_URL = 'https://vpic.nhtsa.dot.gov/api';

const tools: McpToolExport['tools'] = [
  {
    name: 'decode_vin',
    description:
      'Decode a 17-character Vehicle Identification Number (VIN) to get make, model, year, body style, engine, and other attributes.',
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
    description: 'Retrieve all vehicle makes (brands) registered with NHTSA.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_models',
    description: 'Get all vehicle models available for a specific make and model year.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        make: { type: 'string', description: 'Vehicle make name (e.g., "Toyota", "Ford", "BMW")' },
        year: { type: 'number', description: 'Model year (e.g., 2022)' },
      },
      required: ['make', 'year'],
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
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

interface NhtsaResult {
  Variable?: string;
  Value?: string | null;
  ValueId?: string | null;
}

async function decodeVin(vin: string) {
  const res = await fetch(`${BASE_URL}/vehicles/DecodeVin/${encodeURIComponent(vin)}?format=json`);
  if (!res.ok) throw new Error(`NHTSA error: ${res.status} ${res.statusText}`);

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
  const res = await fetch(`${BASE_URL}/vehicles/GetAllMakes?format=json`);
  if (!res.ok) throw new Error(`NHTSA error: ${res.status} ${res.statusText}`);

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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NHTSA error: ${res.status} ${res.statusText}`);

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

export default { tools, callTool } satisfies McpToolExport;
