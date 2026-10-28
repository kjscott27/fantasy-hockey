import type { ProSchedule } from "../espn/proSchedule.ts";
import { nhlAbbrev, type TeamStanding } from "../nhl/client.ts";

/** A night with this many games or fewer is an "off night": fewer lineup conflicts, so those games are easier to use. */
export const OFF_NIGHT_MAX_GAMES = 7;

export interface FantasyWeek {
  label: string;
  scoringPeriods: number[];
  /** Periods before this one are already played. */
  currentPeriod: number;
}

/**
 * Monday-Sunday week containing `period`. Used until league settings are available;
 * ESPN matchup periods are usually Mon-Sun but can be longer (e.g. around the All-Star break).
 */
export function calendarWeek(schedule: ProSchedule, period: number, currentPeriod = period): FantasyWeek {
  const date = schedule.periodToDate(period);
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const monday = period - ((dayOfWeek + 6) % 7);
  const scoringPeriods = Array.from({ length: 7 }, (_, i) => monday + i);
  return {
    label: `${schedule.periodToDate(monday)} to ${schedule.periodToDate(monday + 6)}`,
    scoringPeriods,
    currentPeriod,
  };
}

/** Week defined by the league's matchup schedule (mSettings scheduleSettings.matchupPeriods). */
export function matchupWeek(
  schedule: ProSchedule,
  matchupPeriods: Record<string, number[]>,
  matchupPeriodId: number,
  currentPeriod: number,
): FantasyWeek {
  const scoringPeriods = matchupPeriods[String(matchupPeriodId)];
  if (!scoringPeriods?.length) throw new Error(`Matchup period ${matchupPeriodId} not found in league settings`);
  const first = scoringPeriods[0];
  const last = scoringPeriods[scoringPeriods.length - 1];
  return {
    label: `Matchup ${matchupPeriodId}: ${schedule.periodToDate(first)} to ${schedule.periodToDate(last)}`,
    scoringPeriods,
    currentPeriod,
  };
}

export interface DaySummary {
  period: number;
  date: string;
  games: number;
  offNight: boolean;
  remaining: boolean;
}

export interface TeamGame {
  period: number;
  date: string;
  opponentId: number;
  opponent: string;
  home: boolean;
  offNight: boolean;
  remaining: boolean;
  /** Opponent's goals against per game: higher means a softer matchup for skaters. */
  opponentGaPerGame: number | null;
  /** Opponent's goals for per game: lower means a softer matchup for goalies. */
  opponentGfPerGame: number | null;
}

export interface TeamWeek {
  teamId: number;
  abbrev: string;
  games: TeamGame[];
  total: number;
  remaining: number;
  remainingOffNight: number;
  backToBacks: number;
}

export interface WeekAnalysis {
  week: FantasyWeek;
  days: DaySummary[];
  teams: TeamWeek[];
}

export function analyzeWeek(
  schedule: ProSchedule,
  week: FantasyWeek,
  standings?: Map<string, TeamStanding>,
): WeekAnalysis {
  const periods = new Set(week.scoringPeriods);
  const weekGames = schedule.games.filter((g) => periods.has(g.scoringPeriodId));

  const gamesPerPeriod = new Map<number, number>();
  for (const g of weekGames) gamesPerPeriod.set(g.scoringPeriodId, (gamesPerPeriod.get(g.scoringPeriodId) ?? 0) + 1);

  const days: DaySummary[] = week.scoringPeriods.map((period) => {
    const games = gamesPerPeriod.get(period) ?? 0;
    return {
      period,
      date: schedule.periodToDate(period),
      games,
      offNight: games > 0 && games <= OFF_NIGHT_MAX_GAMES,
      remaining: period >= week.currentPeriod,
    };
  });
  const dayByPeriod = new Map(days.map((d) => [d.period, d]));

  const teams: TeamWeek[] = [...schedule.teams.values()].map((team) => {
    const games: TeamGame[] = weekGames
      .filter((g) => g.homeId === team.id || g.awayId === team.id)
      .map((g) => {
        const opponentId = g.homeId === team.id ? g.awayId : g.homeId;
        const opponent = schedule.teams.get(opponentId)?.abbrev ?? String(opponentId);
        const standing = standings?.get(nhlAbbrev(opponent));
        const day = dayByPeriod.get(g.scoringPeriodId)!;
        return {
          period: g.scoringPeriodId,
          date: g.date,
          opponentId,
          opponent,
          home: g.homeId === team.id,
          offNight: day.offNight,
          remaining: day.remaining,
          opponentGaPerGame: standing?.goalsAgainstPerGame ?? null,
          opponentGfPerGame: standing?.goalsForPerGame ?? null,
        };
      });

    const remainingGames = games.filter((g) => g.remaining);
    const backToBacks = games.filter((g, i) => i > 0 && g.period - games[i - 1].period === 1).length;

    return {
      teamId: team.id,
      abbrev: team.abbrev,
      games,
      total: games.length,
      remaining: remainingGames.length,
      remainingOffNight: remainingGames.filter((g) => g.offNight).length,
      backToBacks,
    };
  });

  teams.sort((a, b) => b.remaining - a.remaining || b.remainingOffNight - a.remainingOffNight || a.abbrev.localeCompare(b.abbrev));
  return { week, days, teams };
}
