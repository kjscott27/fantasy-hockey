/** Shape of data/latest.json: the hand-off between the snapshot script, the HTML report and advice sessions. */

export interface SnapshotPlayer {
  id: number;
  name: string;
  position: string;
  eligible: string[];
  team: string;
  injuryStatus: string;
  /** ONTEAM, FREEAGENT or WAIVERS. */
  status: string;
  percentOwned: number;
  percentChange: number;
  droppable: boolean;
  lineupSlot: string | null;
  /** Fantasy points per game played under this league's scoring. `value` is the blend used for decisions. */
  ppg: {
    value: number;
    season: number | null;
    last7: number | null;
    last15: number | null;
    last30: number | null;
    projected: number | null;
    lastSeason: number | null;
  };
  gp: { season: number; last7: number; last15: number };
  /** Goalies: expected share of team games started. */
  startShare: number | null;
  availability: number;
  /** Projections in isolation (not lineup-aware): per-team-game value x games. */
  thisWeek: { gamesLeft: number; offNightGamesLeft: number; projectedPoints: number };
  nextWeek: { games: number; projectedPoints: number };
  lastNewsDate: string | null;
}

export interface SnapshotDay {
  period: number;
  date: string;
  games: number;
  offNight: boolean;
  remaining: boolean;
}

export interface SnapshotLineupDay {
  period: number;
  date: string;
  total: number;
  starters: { id: number; name: string; slot: string; value: number }[];
  benchedWithGame: { id: number; name: string; value: number }[];
}

export interface SnapshotSwap {
  drop: { id: number; name: string; position: string; team: string; value: number };
  add: { id: number; name: string; position: string; team: string; value: number; status: string; percentOwned: number };
  usableFrom: string;
  thisWeekGain: number;
  nextWeekGain: number;
  totalGain: number;
  /** Difference in rest-of-season points per team game. */
  rosDiff: number;
}

export interface SnapshotTeam {
  id: number;
  name: string;
  abbrev: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface Snapshot {
  generatedAt: string;
  league: {
    id: string;
    name: string;
    season: number;
    scoringType: string;
    scoring: { stat: string; points: number }[];
    lineupSlots: Record<string, number>;
    benchSlots: number;
    irSlots: number;
    matchupAcquisitionLimit: number;
    waiverHours: number;
  };
  myTeam: SnapshotTeam;
  standings: SnapshotTeam[];
  week: {
    matchupPeriod: number;
    label: string;
    today: string;
    currentPeriod: number;
    days: SnapshotDay[];
    nextWeekLabel: string;
    nextWeekDays: SnapshotDay[];
  };
  acquisitions: { limit: number; used: number; remaining: number | null };
  matchup: {
    opponent: SnapshotTeam;
    myPoints: number;
    opponentPoints: number;
    myProjectedRest: number;
    opponentProjectedRest: number;
  } | null;
  myRoster: SnapshotPlayer[];
  opponentRoster: SnapshotPlayer[];
  freeAgents: SnapshotPlayer[];
  lineupPlan: SnapshotLineupDay[];
  todayChanges: { action: "start" | "bench"; id: number; name: string; slot: string | null }[];
  swaps: SnapshotSwap[];
  alerts: { level: "warn" | "info"; message: string }[];
  schedule: {
    team: string;
    gamesLeft: number;
    offNightGamesLeft: number;
    backToBacks: number;
    nextWeekGames: number;
    games: { date: string; opponent: string; home: boolean; offNight: boolean; remaining: boolean }[];
  }[];
  /** Modelling assumptions worth remembering when reading the numbers. */
  notes: string[];
}
