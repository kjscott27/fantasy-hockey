import { RunError } from "../errors.ts";

const NHL_API = "https://api-web.nhle.com/v1";

/** ESPN abbreviations that differ from the NHL's. */
const ESPN_TO_NHL_ABBREV: Record<string, string> = {
  NJ: "NJD",
  SJ: "SJS",
  TB: "TBL",
  LA: "LAK",
};

export function nhlAbbrev(espnAbbrev: string): string {
  return ESPN_TO_NHL_ABBREV[espnAbbrev] ?? espnAbbrev;
}

export interface TeamStanding {
  abbrev: string;
  gamesPlayed: number;
  points: number;
  pointPct: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  last10: string;
}

interface RawStanding {
  teamAbbrev: { default: string };
  gamesPlayed: number;
  points: number;
  pointPctg: number;
  goalFor: number;
  goalAgainst: number;
  l10Wins: number;
  l10Losses: number;
  l10OtLosses: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${NHL_API}${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new RunError("NHL_API", `NHL API returned ${res.status} for ${path}`, { status: res.status, path });
  return (await res.json()) as T;
}

/** Current standings keyed by NHL abbreviation. */
export async function fetchStandings(): Promise<Map<string, TeamStanding>> {
  const { standings } = await getJson<{ standings: RawStanding[] }>("/standings/now");
  const perGame = (n: number, gp: number) => (gp > 0 ? n / gp : 0);

  return new Map(
    standings.map((s) => {
      const abbrev = s.teamAbbrev.default;
      return [
        abbrev,
        {
          abbrev,
          gamesPlayed: s.gamesPlayed,
          points: s.points,
          pointPct: s.pointPctg,
          goalsForPerGame: perGame(s.goalFor, s.gamesPlayed),
          goalsAgainstPerGame: perGame(s.goalAgainst, s.gamesPlayed),
          last10: `${s.l10Wins}-${s.l10Losses}-${s.l10OtLosses}`,
        },
      ];
    }),
  );
}
