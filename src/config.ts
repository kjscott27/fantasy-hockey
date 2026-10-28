import { existsSync } from "node:fs";
import path from "node:path";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

export interface Config {
  season: number;
  leagueId: string | null;
  teamId: number | null;
  espnS2: string | null;
  swid: string | null;
}

export function loadConfig(): Config {
  const envFile = path.join(PROJECT_ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const env = (key: string) => process.env[key]?.trim() || null;
  const teamId = env("ESPN_TEAM_ID");

  return {
    season: Number(env("ESPN_SEASON") ?? 2027),
    leagueId: env("ESPN_LEAGUE_ID"),
    teamId: teamId ? Number(teamId) : null,
    espnS2: env("ESPN_S2"),
    swid: env("ESPN_SWID"),
  };
}

export function requireLeague(config: Config): Config & { leagueId: string } {
  if (!config.leagueId) {
    throw new Error("ESPN_LEAGUE_ID is not set. Copy .env.example to .env and fill it in.");
  }
  if (!config.espnS2 || !config.swid) {
    throw new Error("ESPN_S2 and ESPN_SWID are required for a private league. See .env.example.");
  }
  return config as Config & { leagueId: string };
}
