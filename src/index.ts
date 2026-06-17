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
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * NHTSA MCP — wraps the NHTSA vPIC (Vehicle Product Information Catalog) API (free, no auth)
 *
 * Tools:
 * - decode_vin: decode a Vehicle Identification Number into make, model, year, and attributes
 * - get_makes: retrieve all vehicle makes registered with NHTSA
 * - get_models: retrieve all models for a given make and model year
 */


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
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function reqVehicle(make: string, model: string, year: number) {
  if (!make || !model || !year) {
    throw new Error('make, model, and model_year are all required (e.g., make:"Honda", model:"Civic", model_year:2021).');
  }
}

async function getRecalls(make: string, model: string, modelYear: number) {
  reqVehicle(make, model, modelYear);
  const url = `${SAFETY_BASE}/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${modelYear}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`NHTSA recalls error: ${res.status}`);
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
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`NHTSA complaints error: ${res.status}`);
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
  const lookupRes = await fetch(lookupUrl, { headers: { Accept: 'application/json' } });
  if (!lookupRes.ok) throw new Error(`NHTSA safety ratings error: ${lookupRes.status}`);
  const lookup = (await lookupRes.json()) as { Count?: number; Results?: Array<{ VehicleId?: number; VehicleDescription?: string }> };
  const variants = (lookup.Results ?? []).filter((v) => v.VehicleId);
  if (variants.length === 0) {
    return { make, model, model_year: modelYear, count: 0, note: 'No NCAP crash-test ratings published for this make/model/year (not all vehicles are tested).', ratings: [] };
  }

  // Each VehicleId is a tested variant (body style/drivetrain). Resolve up to 5.
  const ratings = await Promise.all(
    variants.slice(0, 5).map(async (v) => {
      const r = await fetch(`${SAFETY_BASE}/SafetyRatings/VehicleId/${v.VehicleId}`, { headers: { Accept: 'application/json' } });
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

export default { tools, callTool, meter: { credits: 5 } } satisfies McpToolExport;
