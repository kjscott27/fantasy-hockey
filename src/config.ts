import { existsSync } from "node:fs";
import path from "node:path";
import { RunError } from "./errors.ts";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

export interface EmailConfig {
  /** Dedicated sender Gmail account, not your main one. */
  user: string;
  appPassword: string;
  to: string;
}

export interface Config {
  season: number;
  leagueId: string | null;
  teamId: number | null;
  espnS2: string | null;
  swid: string | null;
  /** Null unless all three NOTIFY_* email settings are set. */
  email: EmailConfig | null;
  reportUrl: string | null;
}

export function loadConfig(): Config {
  const envFile = path.join(PROJECT_ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const env = (key: string) => process.env[key]?.trim() || null;
  const teamId = env("ESPN_TEAM_ID");

  const emailUser = env("NOTIFY_GMAIL_USER");
  // Google shows App Passwords in groups of four ("abcd efgh ..."); accept either form.
  const appPassword = env("NOTIFY_GMAIL_APP_PASSWORD")?.replace(/\s+/g, "");
  const emailTo = env("NOTIFY_EMAIL_TO");

  return {
    season: Number(env("ESPN_SEASON") ?? 2027),
    leagueId: env("ESPN_LEAGUE_ID"),
    teamId: teamId ? Number(teamId) : null,
    espnS2: env("ESPN_S2"),
    swid: env("ESPN_SWID"),
    email: emailUser && appPassword && emailTo ? { user: emailUser, appPassword, to: emailTo } : null,
    reportUrl: env("REPORT_URL"),
  };
}

export function requireLeague(config: Config): Config & { leagueId: string } {
  if (!config.leagueId) {
    throw new RunError("CONFIG_MISSING", "ESPN_LEAGUE_ID is not set. Copy .env.example to .env and fill it in.");
  }
  if (!config.espnS2 || !config.swid) {
    throw new RunError("CONFIG_MISSING", "ESPN_S2 and ESPN_SWID are required for a private league. See .env.example.");
  }
  return config as Config & { leagueId: string };
}
