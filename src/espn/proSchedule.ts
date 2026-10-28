import { RunError } from "../errors.ts";
import type { EspnClient } from "./client.ts";

interface RawProGame {
  id: number;
  date: number;
  awayProTeamId: number;
  homeProTeamId: number;
  scoringPeriodId: number;
}

interface RawProTeam {
  id: number;
  abbrev: string;
  location: string;
  name: string;
  proGamesByScoringPeriod?: Record<string, RawProGame[]>;
}

interface RawSeason {
  settings: { proTeams: RawProTeam[] };
}

export interface ProTeam {
  id: number;
  abbrev: string;
  name: string;
}

export interface ProGame {
  id: number;
  scoringPeriodId: number;
  /** Game date in US Eastern time, YYYY-MM-DD. */
  date: string;
  startUtc: string;
  homeId: number;
  awayId: number;
}

export interface ProSchedule {
  teams: Map<number, ProTeam>;
  games: ProGame[];
  periodToDate(period: number): string;
  dateToPeriod(date: string): number;
}

const easternDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

export function toEasternDate(d: Date): string {
  return easternDate.format(d);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** ESPN's NHL schedule. Scoring periods are calendar days (Eastern), one per day of the season. */
export async function fetchProSchedule(espn: EspnClient): Promise<ProSchedule> {
  const raw = await espn.season<RawSeason>({ views: ["proTeamSchedules_wl"] });

  const teams = new Map<number, ProTeam>();
  const gamesById = new Map<number, ProGame>();

  for (const team of raw.settings.proTeams) {
    if (team.id === 0) continue; // "FA" pseudo-team
    teams.set(team.id, { id: team.id, abbrev: team.abbrev, name: `${team.location} ${team.name}` });

    for (const games of Object.values(team.proGamesByScoringPeriod ?? {})) {
      for (const g of games) {
        if (gamesById.has(g.id)) continue;
        const start = new Date(g.date);
        gamesById.set(g.id, {
          id: g.id,
          scoringPeriodId: g.scoringPeriodId,
          date: toEasternDate(start),
          startUtc: start.toISOString(),
          homeId: g.homeProTeamId,
          awayId: g.awayProTeamId,
        });
      }
    }
  }

  const games = [...gamesById.values()].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  if (games.length === 0) throw new RunError("ESPN_FORMAT", "ESPN returned an empty NHL schedule");

  // Anchor the period <-> date mapping on the first game, then sanity-check the rest.
  const anchor = games[0];
  const periodToDate = (period: number) => addDays(anchor.date, period - anchor.scoringPeriodId);
  const dateToPeriod = (date: string) => anchor.scoringPeriodId + daysBetween(anchor.date, date);

  const mismatch = games.find((g) => periodToDate(g.scoringPeriodId) !== g.date);
  if (mismatch) {
    throw new RunError(
      "ESPN_FORMAT",
      `Scoring period ${mismatch.scoringPeriodId} doesn't map to ${mismatch.date}; ESPN changed its schedule format`,
    );
  }

  return { teams, games, periodToDate, dateToPeriod };
}
