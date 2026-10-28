import type { EspnClient } from "./client.ts";
import { POSITION_NAMES, SLOT_NAMES, STAT_SOURCE, STAT_SPLIT, statName } from "./statMap.ts";

// ---- Raw ESPN shapes (only the fields we read) ----

interface RawStatBlock {
  seasonId: number;
  statSourceId: number;
  statSplitTypeId: number;
  appliedAverage?: number;
  appliedTotal?: number;
  /** Missing on some blocks (e.g. players without games in the split). */
  stats?: Record<string, number>;
}

interface RawPlayer {
  id: number;
  fullName: string;
  defaultPositionId: number;
  eligibleSlots: number[];
  proTeamId: number;
  injuryStatus?: string;
  droppable?: boolean;
  lastNewsDate?: number;
  ownership?: { percentOwned?: number; percentChange?: number };
  stats?: RawStatBlock[];
}

interface RawPlayerPoolEntry {
  onTeamId: number;
  status: string;
  player: RawPlayer;
}

interface RawTeam {
  id: number;
  name?: string;
  location?: string;
  nickname?: string;
  abbrev: string;
  owners?: string[];
  record?: { overall?: { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number } };
  transactionCounter?: { matchupAcquisitionTotals?: Record<string, number> };
  roster?: { entries: { lineupSlotId: number; playerPoolEntry: RawPlayerPoolEntry }[] };
}

interface RawMatchupSide {
  teamId: number;
  totalPoints: number;
  totalPointsLive?: number;
  pointsByScoringPeriod?: Record<string, number>;
}

interface RawLeague {
  scoringPeriodId: number;
  settings: {
    name: string;
    acquisitionSettings: { matchupAcquisitionLimit: number; acquisitionLimit: number; waiverHours: number };
    rosterSettings: {
      lineupSlotCounts: Record<string, number>;
      lineupLocktimeType: string;
      /** Keyed by defaultPositionId; -1 or 0 = no limit. */
      positionLimits?: Record<string, number>;
    };
    scoringSettings: { scoringType: string; scoringItems: { statId: number; points: number }[] };
  };
  status: { currentMatchupPeriod: number; latestScoringPeriod: number };
  teams: RawTeam[];
  schedule: { matchupPeriodId: number; winner: string; home: RawMatchupSide; away?: RawMatchupSide }[];
}

// ---- Domain types ----

export interface Split {
  /** Fantasy points per game under this league's scoring (ESPN's appliedAverage). */
  ppg: number | null;
  gp: number;
  total: number | null;
}

export interface PlayerStats {
  season: Split;
  last7: Split;
  last15: Split;
  last30: Split;
  projected: Split;
  lastSeason: Split;
}

export interface Player {
  id: number;
  name: string;
  position: string;
  /** Lineup slot names this player can fill (excludes BN/IR). */
  eligible: string[];
  proTeamId: number;
  injuryStatus: string;
  droppable: boolean;
  percentOwned: number;
  percentChange: number;
  /** ONTEAM, FREEAGENT or WAIVERS. */
  status: string;
  onTeamId: number;
  stats: PlayerStats;
  /** Goalies only: starts this season and ESPN's projected season starts. */
  goalieStarts: { actual: number; projected: number } | null;
  lastNewsDate: string | null;
}

export interface RosterPlayer extends Player {
  lineupSlot: string;
}

export interface LeagueTeam {
  id: number;
  name: string;
  abbrev: string;
  owners: string[];
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  acquisitionsByMatchup: Record<string, number>;
  roster: RosterPlayer[];
}

export interface Matchup {
  matchupPeriodId: number;
  winner: string;
  homeId: number;
  awayId: number | null;
  homePoints: number;
  awayPoints: number;
}

export interface LeagueSettings {
  name: string;
  scoringType: string;
  scoring: { statId: number; stat: string; points: number }[];
  /** Active lineup slots only, e.g. { C: 2, LW: 2, RW: 2, D: 4, G: 2 }. */
  lineupSlots: Record<string, number>;
  benchSlots: number;
  irSlots: number;
  /** Max rostered players per position, e.g. { G: 3 }. Players on IR don't count. */
  positionLimits: Record<string, number>;
  matchupAcquisitionLimit: number;
  waiverHours: number;
  lineupLocktimeType: string;
}

export interface League {
  settings: LeagueSettings;
  currentMatchupPeriod: number;
  currentScoringPeriod: number;
  teams: LeagueTeam[];
  matchups: Matchup[];
}

// ---- Parsing ----

const NON_LINEUP_SLOTS = new Set(["BN", "IR"]);

function split(blocks: RawStatBlock[], season: number, source: number, splitType: number): Split {
  const b = blocks.find((s) => s.seasonId === season && s.statSourceId === source && s.statSplitTypeId === splitType);
  if (!b) return { ppg: null, gp: 0, total: null };
  const gp = b.stats?.["30"] ?? b.stats?.["34"] ?? 0;
  return { ppg: gp > 0 ? (b.appliedAverage ?? null) : null, gp, total: b.appliedTotal ?? null };
}

export function parsePlayer(entry: RawPlayerPoolEntry, season: number): Player {
  const p = entry.player;
  const blocks = p.stats ?? [];
  const position = POSITION_NAMES[p.defaultPositionId] ?? String(p.defaultPositionId);

  const seasonBlock = blocks.find((s) => s.seasonId === season && s.statSourceId === STAT_SOURCE.actual && s.statSplitTypeId === STAT_SPLIT.season);
  const projBlock = blocks.find((s) => s.seasonId === season && s.statSourceId === STAT_SOURCE.projected && s.statSplitTypeId === STAT_SPLIT.season);

  return {
    id: p.id,
    name: p.fullName,
    position,
    eligible: p.eligibleSlots.map((s) => SLOT_NAMES[s]).filter((s): s is string => !!s && !NON_LINEUP_SLOTS.has(s)),
    proTeamId: p.proTeamId,
    injuryStatus: p.injuryStatus ?? "ACTIVE",
    droppable: p.droppable ?? true,
    percentOwned: p.ownership?.percentOwned ?? 0,
    percentChange: p.ownership?.percentChange ?? 0,
    status: entry.status,
    onTeamId: entry.onTeamId,
    stats: {
      season: split(blocks, season, STAT_SOURCE.actual, STAT_SPLIT.season),
      last7: split(blocks, season, STAT_SOURCE.actual, STAT_SPLIT.last7),
      last15: split(blocks, season, STAT_SOURCE.actual, STAT_SPLIT.last15),
      last30: split(blocks, season, STAT_SOURCE.actual, STAT_SPLIT.last30),
      projected: split(blocks, season, STAT_SOURCE.projected, STAT_SPLIT.season),
      lastSeason: split(blocks, season - 1, STAT_SOURCE.actual, STAT_SPLIT.season),
    },
    goalieStarts:
      position === "G" ? { actual: seasonBlock?.stats?.["0"] ?? 0, projected: projBlock?.stats?.["0"] ?? 0 } : null,
    lastNewsDate: p.lastNewsDate ? new Date(p.lastNewsDate).toISOString() : null,
  };
}

function parseTeam(t: RawTeam, season: number): LeagueTeam {
  const record = t.record?.overall;
  return {
    id: t.id,
    name: t.name ?? `${t.location ?? ""} ${t.nickname ?? ""}`.trim(),
    abbrev: t.abbrev,
    owners: t.owners ?? [],
    wins: record?.wins ?? 0,
    losses: record?.losses ?? 0,
    ties: record?.ties ?? 0,
    pointsFor: record?.pointsFor ?? 0,
    pointsAgainst: record?.pointsAgainst ?? 0,
    acquisitionsByMatchup: t.transactionCounter?.matchupAcquisitionTotals ?? {},
    roster: (t.roster?.entries ?? []).map((e) => ({
      ...parsePlayer(e.playerPoolEntry, season),
      lineupSlot: SLOT_NAMES[e.lineupSlotId] ?? String(e.lineupSlotId),
    })),
  };
}

function parseSettings(raw: RawLeague): LeagueSettings {
  const s = raw.settings;
  const lineupSlots: Record<string, number> = {};
  let benchSlots = 0;
  let irSlots = 0;
  for (const [id, count] of Object.entries(s.rosterSettings.lineupSlotCounts)) {
    const name = SLOT_NAMES[Number(id)];
    if (!name || count <= 0) continue;
    if (name === "BN") benchSlots = count;
    else if (name === "IR") irSlots = count;
    else lineupSlots[name] = count;
  }
  const positionLimits: Record<string, number> = {};
  for (const [id, max] of Object.entries(s.rosterSettings.positionLimits ?? {})) {
    const name = POSITION_NAMES[Number(id)];
    if (name && max > 0) positionLimits[name] = max;
  }
  return {
    name: s.name,
    scoringType: s.scoringSettings.scoringType,
    scoring: s.scoringSettings.scoringItems.map((i) => ({ statId: i.statId, stat: statName(i.statId), points: i.points })),
    lineupSlots,
    benchSlots,
    irSlots,
    positionLimits,
    matchupAcquisitionLimit: s.acquisitionSettings.matchupAcquisitionLimit,
    waiverHours: s.acquisitionSettings.waiverHours,
    lineupLocktimeType: s.rosterSettings.lineupLocktimeType,
  };
}

/** Settings, teams with rosters, and the matchup schedule in one request. */
export async function fetchLeague(espn: EspnClient, season: number): Promise<League> {
  const raw = await espn.league<RawLeague>({ views: ["mSettings", "mStatus", "mTeam", "mRoster", "mMatchupScore"] });
  return {
    settings: parseSettings(raw),
    currentMatchupPeriod: raw.status.currentMatchupPeriod,
    currentScoringPeriod: raw.scoringPeriodId,
    teams: raw.teams.map((t) => parseTeam(t, season)),
    matchups: raw.schedule.map((m) => ({
      matchupPeriodId: m.matchupPeriodId,
      winner: m.winner,
      homeId: m.home.teamId,
      awayId: m.away?.teamId ?? null,
      homePoints: m.home.totalPointsLive ?? m.home.totalPoints,
      awayPoints: m.away ? (m.away.totalPointsLive ?? m.away.totalPoints) : 0,
    })),
  };
}

/** Best available free agents and waiver players, by percent owned. */
export async function fetchFreeAgents(espn: EspnClient, season: number, scoringPeriodId: number, limit = 150): Promise<Player[]> {
  const raw = await espn.league<{ players: RawPlayerPoolEntry[] }>({
    views: ["kona_player_info"],
    params: { scoringPeriodId },
    filter: {
      players: {
        filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
        limit,
        sortPercOwned: { sortPriority: 1, sortAsc: false },
      },
    },
  });
  return raw.players.map((p) => parsePlayer(p, season));
}
