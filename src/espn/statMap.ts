/**
 * ESPN fantasy hockey stat IDs.
 *
 * Verified 2026-10-28 by comparing ESPN season totals for McDavid, MacKinnon,
 * Celebrini, Vasilevskiy, Oettinger and Swayman with api.nhle.com/stats.
 * IDs marked "unverified" didn't line up with any NHL stat and are kept only so
 * unknown values still get a label.
 */
export const STAT_NAMES: Record<number, string> = {
  // Goalies
  0: "GS",
  1: "W",
  2: "L",
  3: "SA",
  4: "GA",
  6: "SV",
  7: "SO",
  8: "G_TOI", // seconds
  9: "OTL",
  10: "GAA",
  11: "SV%",
  12: "W%", // wins / starts

  // Skaters
  13: "G",
  14: "A",
  15: "+/-",
  16: "PTS",
  17: "PIM",
  18: "PPG",
  19: "PPA",
  20: "SHG",
  21: "SHA",
  22: "GWG",
  23: "FOW",
  24: "FOL",
  25: "STAT_25", // unverified (~27 per game; possibly shifts)
  26: "TOI", // seconds
  27: "ATOI", // seconds per game
  29: "SOG",
  30: "GP_30", // unverified; equals games played in every sample
  31: "HIT",
  32: "BLK",
  34: "GP",
  35: "STG", // PPG + SHG
  36: "STA", // PPA + SHA
  37: "STP", // PPP + SHP
  38: "PPP",
  39: "SHP",
};

/** Categories where a lower number is better. */
export const LOWER_IS_BETTER = new Set([2, 4, 9, 10, 17, 24]);

/** Rate stats: can't be summed across players or divided per game. */
export const RATE_STATS = new Set([10, 11, 12, 27]);

export const GOALIE_STATS = new Set([0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12]);

export function statName(id: number | string): string {
  return STAT_NAMES[Number(id)] ?? `STAT_${id}`;
}

/** Lineup slot IDs, as used in eligibleSlots and lineupSlotId. */
export const SLOT_NAMES: Record<number, string> = {
  0: "C",
  1: "LW",
  2: "RW",
  3: "F",
  4: "D",
  5: "G",
  6: "UTIL",
  7: "BN",
  8: "IR",
};

/** defaultPositionId on a player (different numbering than slots). */
export const POSITION_NAMES: Record<number, string> = {
  1: "C",
  2: "LW",
  3: "RW",
  4: "D",
  5: "G",
};

/**
 * Stat block identifiers in player.stats[]:
 * statSourceId 0 = actual, 1 = ESPN projection.
 * statSplitTypeId 0 = season, 1 = last 7 days, 2 = last 15, 3 = last 30, 5 = single game.
 */
export const STAT_SOURCE = { actual: 0, projected: 1 } as const;
export const STAT_SPLIT = { season: 0, last7: 1, last15: 2, last30: 3, game: 5 } as const;
