import type { Player, PlayerStats } from "../espn/league.ts";

export interface Valuation {
  /** Blended fantasy points per game played. */
  ppg: number;
  /** Goalies: expected share of team games started. Skaters: 1. */
  startShare: number;
  /** 0 = out, 0.75 = day-to-day, 1 = healthy. */
  availability: number;
  /** Expected fantasy points each time the player's NHL team plays. */
  perTeamGame: number;
}

/**
 * Blend weights. ESPN's projection anchors the estimate early in the season; actual
 * results take over as sample sizes grow. A split's weight scales down until it has
 * `fullSample` games, so a 2-game hot streak can't dominate.
 */
const BLEND: { key: keyof PlayerStats; weight: number; fullSample: number }[] = [
  { key: "projected", weight: 0.35, fullSample: 1 },
  { key: "season", weight: 0.25, fullSample: 10 },
  { key: "last15", weight: 0.25, fullSample: 5 },
  { key: "last7", weight: 0.15, fullSample: 3 },
];

const UNAVAILABLE = new Set(["OUT", "INJURY_RESERVE", "SUSPENSION"]);

/** Stands in for the projection when ESPN has none (common for call-ups and backup goalies). */
const FALLBACK_ANCHOR = { key: "lastSeason", weight: 0.35, fullSample: 20 } as const;

export function blendedPpg(stats: PlayerStats): number {
  const blend = stats.projected.ppg === null ? [FALLBACK_ANCHOR, ...BLEND.slice(1)] : BLEND;
  let sum = 0;
  let weights = 0;
  for (const { key, weight, fullSample } of blend) {
    const s = stats[key];
    if (s.ppg === null || s.gp === 0) continue;
    const w = weight * Math.min(1, s.gp / fullSample);
    sum += s.ppg * w;
    weights += w;
  }
  if (weights > 0) return sum / weights;
  return stats.lastSeason.ppg ?? 0;
}

export function availability(injuryStatus: string): number {
  if (UNAVAILABLE.has(injuryStatus)) return 0;
  if (injuryStatus === "DAY_TO_DAY") return 0.75;
  return 1;
}

/**
 * Share of team games a goalie will start: ESPN's projected starts, shifting toward
 * this season's actual usage as the team plays more games.
 */
export function goalieStartShare(
  starts: { actual: number; projected: number },
  teamGamesPlayed: number,
  teamSeasonGames: number,
): number {
  const projectedShare = starts.projected > 0 && teamSeasonGames > 0 ? starts.projected / teamSeasonGames : 0.5;
  if (teamGamesPlayed === 0) return Math.min(1, projectedShare);
  const actualShare = starts.actual / teamGamesPlayed;
  const actualWeight = 0.6 * Math.min(1, teamGamesPlayed / 20);
  return Math.min(1, actualShare * actualWeight + projectedShare * (1 - actualWeight));
}

export function valuePlayer(player: Player, teamGamesPlayed: number, teamSeasonGames: number): Valuation {
  const ppg = blendedPpg(player.stats);
  const startShare = player.goalieStarts ? goalieStartShare(player.goalieStarts, teamGamesPlayed, teamSeasonGames) : 1;
  const avail = availability(player.injuryStatus);
  return { ppg, startShare, availability: avail, perTeamGame: ppg * startShare * avail };
}
