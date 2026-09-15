/**
 * Settlement configuration, read per season from `season.config` —
 * never hardcoded (spec section 2: "Config (per season — never
 * hardcode)"). Parsing is strict: a missing or malformed key throws
 * rather than silently defaulting, because a wrong rate quietly
 * produces plausible-looking dollars that nobody catches until
 * February.
 */
export type SettlementConfig = {
  entryFeeCents: number;
  baseLossCents: number;
  leaderLossCents: number;
  speedLossCents: number;
  weeklyPoolPerLossCents: number;
  picksPerWeek: number;
  leaderCount: number;
  leaderWeekRange: [number, number];
  finalSpeedWeek: number;
  denzilAwardCents: number;
  denzilCapPerSeason: number;
  seasonPayoutPct: number[];
};

function requireInt(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`season config: "${key}" must be an integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireIntArray(raw: Record<string, unknown>, key: string, length?: number): number[] {
  const value = raw[key];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "number" || !Number.isInteger(v))) {
    throw new Error(`season config: "${key}" must be an array of integers, got ${JSON.stringify(value)}`);
  }
  if (length !== undefined && value.length !== length) {
    throw new Error(`season config: "${key}" must have ${length} entries, got ${value.length}`);
  }
  return value as number[];
}

export function parseSettlementConfig(config: unknown): SettlementConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error(`season config must be a JSON object, got ${JSON.stringify(config)}`);
  }
  const raw = config as Record<string, unknown>;

  const leaderWeekRange = requireIntArray(raw, "leaderWeekRange", 2);
  const seasonPayoutPct = requireIntArray(raw, "seasonPayoutPct");
  const pctTotal = seasonPayoutPct.reduce((sum, p) => sum + p, 0);
  if (pctTotal !== 100) {
    throw new Error(`season config: seasonPayoutPct must sum to 100, got ${pctTotal}`);
  }

  return {
    entryFeeCents: requireInt(raw, "entryFeeCents"),
    baseLossCents: requireInt(raw, "baseLossCents"),
    leaderLossCents: requireInt(raw, "leaderLossCents"),
    speedLossCents: requireInt(raw, "speedLossCents"),
    weeklyPoolPerLossCents: requireInt(raw, "weeklyPoolPerLossCents"),
    picksPerWeek: requireInt(raw, "picksPerWeek"),
    leaderCount: requireInt(raw, "leaderCount"),
    leaderWeekRange: [leaderWeekRange[0], leaderWeekRange[1]],
    finalSpeedWeek: requireInt(raw, "finalSpeedWeek"),
    denzilAwardCents: requireInt(raw, "denzilAwardCents"),
    denzilCapPerSeason: requireInt(raw, "denzilCapPerSeason"),
    seasonPayoutPct,
  };
}
