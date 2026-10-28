/**
 * Pulls league + NHL data, runs the analysis, and writes:
 *   data/latest.json (+ dated copy)  - read during advice sessions
 *   reports/latest.html              - human-readable report
 *
 *   npm run snapshot
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, PROJECT_ROOT, requireLeague } from "./config.ts";
import { EspnClient } from "./espn/client.ts";
import { RunError } from "./errors.ts";
import { fetchFreeAgents, fetchLeague, type LeagueTeam, type Player, type RosterPlayer } from "./espn/league.ts";
import { fetchProSchedule } from "./espn/proSchedule.ts";
import { fetchStandings } from "./nhl/client.ts";
import { analyzeWeek, calendarWeek, type WeekAnalysis } from "./analysis/week.ts";
import { valuePlayer, type Valuation } from "./analysis/value.ts";
import { planWeek, type WeekPlan } from "./analysis/lineup.ts";
import { rosterAlerts, rosValue, suggestSwaps, todayChanges, toPlanPlayer, type PlanningContext } from "./analysis/suggest.ts";
import { renderReport } from "./report/template.ts";
import type { Snapshot, SnapshotDay, SnapshotPlayer, SnapshotTeam } from "./snapshotTypes.ts";

const config = requireLeague(loadConfig());
const espn = new EspnClient(config);

const now = new Date();
console.log("Fetching league, NHL schedule and standings...");
const [league, schedule, standings] = await Promise.all([
  fetchLeague(espn, config.season),
  fetchProSchedule(espn),
  fetchStandings(),
]);
const today = league.currentScoringPeriod;
const freeAgents = await fetchFreeAgents(espn, config.season, today);

const swid = config.swid!.toUpperCase();
const myTeam =
  league.teams.find((t) => t.id === config.teamId) ??
  league.teams.find((t) => t.owners.some((o) => o.toUpperCase() === swid));
if (!myTeam) throw new RunError("TEAM_NOT_FOUND", "Couldn't find your team. Set ESPN_TEAM_ID in .env.");

// ---- Schedule ----

const week = calendarWeek(schedule, today);
const nextWeek = calendarWeek(schedule, today + 7, today);
const thisWeekAnalysis = analyzeWeek(schedule, week, standings, now);
const nextWeekAnalysis = analyzeWeek(schedule, nextWeek, standings, now);

const teamPeriods = new Set(schedule.games.flatMap((g) => [`${g.homeId}:${g.scoringPeriodId}`, `${g.awayId}:${g.scoringPeriodId}`]));
const playsOn = (teamId: number, period: number) => teamPeriods.has(`${teamId}:${period}`);

// Games that have already started. Those players are locked and their points are in the live score.
const startedGames = schedule.games.filter((g) => Date.parse(g.startUtc) <= now.getTime());
const startedPeriods = new Set(startedGames.flatMap((g) => [`${g.homeId}:${g.scoringPeriodId}`, `${g.awayId}:${g.scoringPeriodId}`]));
const started = (teamId: number, period: number) => startedPeriods.has(`${teamId}:${period}`);
const todayGames = schedule.games.filter((g) => g.scoringPeriodId === today);
const todayStarted = todayGames.filter((g) => Date.parse(g.startUtc) <= now.getTime()).length;

const teamGamesPlayed = new Map<number, number>();
const teamSeasonGames = new Map<number, number>();
for (const g of schedule.games) {
  for (const id of [g.homeId, g.awayId]) {
    teamSeasonGames.set(id, (teamSeasonGames.get(id) ?? 0) + 1);
    if (g.scoringPeriodId < today) teamGamesPlayed.set(id, (teamGamesPlayed.get(id) ?? 0) + 1);
  }
}

// ---- Valuation ----

const allPlayers: Player[] = [...league.teams.flatMap((t) => t.roster), ...freeAgents];
const byId = new Map(allPlayers.map((p) => [p.id, p]));
const values = new Map<number, Valuation>();
for (const p of allPlayers) {
  values.set(p.id, valuePlayer(p, teamGamesPlayed.get(p.proTeamId) ?? 0, teamSeasonGames.get(p.proTeamId) ?? 0));
}

// ---- Planning ----

const days = (a: WeekAnalysis, remainingOnly: boolean) =>
  a.days.filter((d) => !remainingOnly || d.remaining).map((d) => ({ period: d.period, date: d.date }));

const ctx: PlanningContext = {
  slots: league.settings.lineupSlots,
  positionLimits: league.settings.positionLimits,
  playsOn,
  started,
  thisWeekDays: days(thisWeekAnalysis, true),
  nextWeekDays: days(nextWeekAnalysis, false),
  today,
};

const planFor = (team: LeagueTeam): WeekPlan =>
  planWeek(
    team.roster.filter((p) => p.lineupSlot !== "IR").map((p) => toPlanPlayer(p, values.get(p.id)!)),
    ctx.thisWeekDays,
    playsOn,
    ctx.slots,
    started,
  );
const myPlan = planFor(myTeam);

const limit = league.settings.matchupAcquisitionLimit;
const used = myTeam.acquisitionsByMatchup[String(league.currentMatchupPeriod)] ?? 0;
const acquisitionsRemaining = limit < 0 ? null : Math.max(0, limit - used);

const matchupRaw = league.matchups.find(
  (m) => m.matchupPeriodId === league.currentMatchupPeriod && (m.homeId === myTeam.id || m.awayId === myTeam.id),
);
const isHome = matchupRaw?.homeId === myTeam.id;
const opponentTeam = matchupRaw
  ? league.teams.find((t) => t.id === (isHome ? matchupRaw.awayId : matchupRaw.homeId))
  : undefined;
const opponentPlan = opponentTeam ? planFor(opponentTeam) : null;

console.log("Evaluating swaps...");
const swaps = suggestSwaps(myTeam.roster, freeAgents, values, ctx, acquisitionsRemaining);
const changes = todayChanges(myTeam.roster, myPlan.days.find((d) => d.period === today), (p) => started(p.proTeamId, today));
const alerts = rosterAlerts(myTeam.roster, values, league.settings.irSlots);

// ---- Serialize ----

const abbrev = (proTeamId: number) => schedule.teams.get(proTeamId)?.abbrev ?? "FA";
const thisWeekByTeam = new Map(thisWeekAnalysis.teams.map((t) => [t.teamId, t]));
const nextWeekByTeam = new Map(nextWeekAnalysis.teams.map((t) => [t.teamId, t]));
const nameOf = (id: number) => byId.get(id)?.name ?? String(id);

function snapPlayer(p: Player | RosterPlayer): SnapshotPlayer {
  const v = values.get(p.id)!;
  const tw = thisWeekByTeam.get(p.proTeamId);
  const gamesLeft = tw?.remaining ?? 0;
  const nextGames = nextWeekByTeam.get(p.proTeamId)?.total ?? 0;
  return {
    id: p.id,
    name: p.name,
    position: p.position,
    eligible: p.eligible.filter((s) => (league.settings.lineupSlots[s] ?? 0) > 0),
    team: abbrev(p.proTeamId),
    injuryStatus: p.injuryStatus,
    status: p.status,
    percentOwned: p.percentOwned,
    percentChange: p.percentChange,
    droppable: p.droppable,
    lineupSlot: "lineupSlot" in p ? p.lineupSlot : null,
    ppg: {
      value: v.ppg,
      season: p.stats.season.ppg,
      last7: p.stats.last7.ppg,
      last15: p.stats.last15.ppg,
      last30: p.stats.last30.ppg,
      projected: p.stats.projected.ppg,
      lastSeason: p.stats.lastSeason.ppg,
    },
    gp: { season: p.stats.season.gp, last7: p.stats.last7.gp, last15: p.stats.last15.gp },
    startShare: p.goalieStarts ? v.startShare : null,
    availability: v.availability,
    thisWeek: { gamesLeft, offNightGamesLeft: tw?.remainingOffNight ?? 0, projectedPoints: v.perTeamGame * gamesLeft },
    nextWeek: { games: nextGames, projectedPoints: v.perTeamGame * nextGames },
    lastNewsDate: p.lastNewsDate,
  };
}

const snapTeam = (t: LeagueTeam): SnapshotTeam => ({
  id: t.id,
  name: t.name,
  abbrev: t.abbrev,
  wins: t.wins,
  losses: t.losses,
  ties: t.ties,
  pointsFor: t.pointsFor,
  pointsAgainst: t.pointsAgainst,
});

const snapDays = (a: WeekAnalysis): SnapshotDay[] => a.days.map((d) => ({ ...d }));
const byValueDesc = (a: Player, b: Player) => rosValue(values.get(b.id)!) - rosValue(values.get(a.id)!);

const notes = [
  "Points per game blend ESPN's season projection (35%), this season (25%), last 15 days (25%) and last 7 days (15%), each down-weighted until it has enough games.",
  "Goalie values are multiplied by their expected share of team starts.",
  "Day-to-day players are discounted 25%; OUT, IR and suspended players count as zero.",
  todayStarted > 0
    ? `${todayStarted} of today's ${todayGames.length} games had started when this ran. Those players are locked: their points are already in the live score, so they're left out of the remaining projection and the Today suggestions.`
    : "None of today's games had started when this ran, so every game today counts as remaining.",
  "Free agents are assumed usable from tomorrow and waiver claims from the day after.",
  "Swap gains are lineup-optimized points over the rest of this week plus all of next week.",
];
if (acquisitionsRemaining === 0) notes.push("No adds left this matchup, so swap gains only count next week.");

const snapshot: Snapshot = {
  generatedAt: now.toISOString(),
  league: {
    id: config.leagueId,
    name: league.settings.name,
    season: config.season,
    scoringType: league.settings.scoringType,
    scoring: league.settings.scoring.map(({ stat, points }) => ({ stat, points })),
    lineupSlots: league.settings.lineupSlots,
    benchSlots: league.settings.benchSlots,
    irSlots: league.settings.irSlots,
    matchupAcquisitionLimit: limit,
    waiverHours: league.settings.waiverHours,
  },
  myTeam: snapTeam(myTeam),
  standings: league.teams.map(snapTeam).sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor),
  week: {
    matchupPeriod: league.currentMatchupPeriod,
    label: week.label,
    today: schedule.periodToDate(today),
    currentPeriod: today,
    days: snapDays(thisWeekAnalysis),
    nextWeekLabel: nextWeek.label,
    nextWeekDays: snapDays(nextWeekAnalysis),
  },
  acquisitions: { limit, used, remaining: acquisitionsRemaining },
  matchup:
    matchupRaw && opponentTeam && opponentPlan
      ? {
          opponent: snapTeam(opponentTeam),
          myPoints: isHome ? matchupRaw.homePoints : matchupRaw.awayPoints,
          opponentPoints: isHome ? matchupRaw.awayPoints : matchupRaw.homePoints,
          myProjectedRest: myPlan.total,
          opponentProjectedRest: opponentPlan.total,
        }
      : null,
  myRoster: myTeam.roster.map(snapPlayer),
  opponentRoster: opponentTeam ? opponentTeam.roster.map(snapPlayer) : [],
  freeAgents: [...freeAgents].sort(byValueDesc).map(snapPlayer),
  lineupPlan: myPlan.days.map((d) => ({
    period: d.period,
    date: d.date,
    total: d.total,
    starters: d.starters.map((s) => ({ ...s, name: nameOf(s.id) })),
    benchedWithGame: d.benchedWithGame.map((b) => ({ ...b, name: nameOf(b.id) })),
  })),
  todayChanges: changes.map((c) => ({ ...c, name: nameOf(c.id) })),
  swaps: swaps.map((s) => {
    const drop = byId.get(s.dropId)!;
    const add = byId.get(s.addId)!;
    return {
      drop: { id: drop.id, name: drop.name, position: drop.position, team: abbrev(drop.proTeamId), value: values.get(drop.id)!.ppg },
      add: {
        id: add.id,
        name: add.name,
        position: add.position,
        team: abbrev(add.proTeamId),
        value: values.get(add.id)!.ppg,
        status: add.status,
        percentOwned: add.percentOwned,
      },
      usableFrom: schedule.periodToDate(s.usableFrom),
      thisWeekGain: s.thisWeekGain,
      nextWeekGain: s.nextWeekGain,
      totalGain: s.totalGain,
      rosDiff: s.rosDiff,
    };
  }),
  alerts,
  schedule: thisWeekAnalysis.teams.map((t) => ({
    team: t.abbrev,
    gamesLeft: t.remaining,
    offNightGamesLeft: t.remainingOffNight,
    backToBacks: t.backToBacks,
    nextWeekGames: nextWeekByTeam.get(t.teamId)?.total ?? 0,
    games: t.games.map((g) => ({ date: g.date, opponent: g.opponent, home: g.home, offNight: g.offNight, remaining: g.remaining })),
  })),
  notes,
};

// Two decimals is plenty and keeps the JSON readable.
const json = JSON.stringify(snapshot, (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v), 2);

const dataDir = path.join(PROJECT_ROOT, "data");
const reportsDir = path.join(PROJECT_ROOT, "reports");
await mkdir(dataDir, { recursive: true });
await mkdir(reportsDir, { recursive: true });
await writeFile(path.join(dataDir, `snapshot-${snapshot.week.today}.json`), json);
await writeFile(path.join(dataDir, "latest.json"), json);
// Write then rename so a web server serving reports/ never sees a half-written page.
const reportPath = path.join(reportsDir, "latest.html");
await writeFile(`${reportPath}.tmp`, renderReport(JSON.parse(json) as Snapshot));
await rename(`${reportPath}.tmp`, reportPath);

// ---- Console summary ----

const fmt = (n: number) => n.toFixed(1);
console.log(`\n${snapshot.myTeam.name} - ${week.label} (matchup ${league.currentMatchupPeriod})`);
if (snapshot.matchup) {
  const m = snapshot.matchup;
  console.log(
    `vs ${m.opponent.name}: ${fmt(m.myPoints)} - ${fmt(m.opponentPoints)}, projected final ${fmt(m.myPoints + m.myProjectedRest)} - ${fmt(m.opponentPoints + m.opponentProjectedRest)}`,
  );
}
console.log(`Adds left this matchup: ${acquisitionsRemaining ?? "unlimited"}`);
for (const c of snapshot.todayChanges) console.log(`Today: ${c.action.toUpperCase()} ${c.name}${c.slot ? ` (${c.slot})` : ""}`);
for (const a of alerts) console.log(`${a.level === "warn" ? "!" : "-"} ${a.message}`);
console.log("\nTop swaps (2-week gain):");
for (const s of snapshot.swaps.slice(0, 5)) {
  console.log(`  +${fmt(s.totalGain)}  drop ${s.drop.name} -> add ${s.add.name} (${s.add.position}, ${s.add.team}${s.add.status === "WAIVERS" ? ", waivers" : ""})`);
}
console.log("\nWrote data/latest.json and reports/latest.html");
