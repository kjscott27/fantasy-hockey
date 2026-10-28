/**
 * Games-per-team for the current (or next) fantasy week.
 *
 *   npm run week            # this week, counting only games not yet played
 *   npm run week -- --next  # next week, for Sunday planning
 */
import { loadConfig } from "./config.ts";
import { EspnClient } from "./espn/client.ts";
import { fetchProSchedule, toEasternDate } from "./espn/proSchedule.ts";
import { fetchStandings } from "./nhl/client.ts";
import { analyzeWeek, calendarWeek, OFF_NIGHT_MAX_GAMES } from "./analysis/week.ts";

const next = process.argv.includes("--next");

const config = loadConfig();
const espn = new EspnClient(config);
const [schedule, standings] = await Promise.all([fetchProSchedule(espn), fetchStandings()]);

const today = schedule.dateToPeriod(toEasternDate(new Date()));
const week = next ? calendarWeek(schedule, today + 7, today + 7) : calendarWeek(schedule, today);
const { days, teams } = analyzeWeek(schedule, week, standings);

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

console.log(`\nWeek ${week.label}${next ? " (next week)" : ""}\n`);
console.log(
  days
    .map((d) => `${weekday(d.date)} ${d.date.slice(5)}  ${String(d.games).padStart(2)} games${d.offNight ? "  OFF NIGHT" : ""}${d.remaining ? "" : "  (played)"}`)
    .join("\n"),
);
console.log(`\nOff night = ${OFF_NIGHT_MAX_GAMES} or fewer games.\n`);

const avg = (xs: (number | null)[]) => {
  const vals = xs.filter((x): x is number => x !== null);
  return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : "  - ";
};

console.log("Team  Left  Off  B2B  OppGA/G  Schedule");
for (const t of teams) {
  const remaining = t.games.filter((g) => g.remaining);
  const sched = remaining.map((g) => `${weekday(g.date)}${g.home ? " " : " @"}${g.opponent}${g.offNight ? "*" : ""}`).join(", ");
  console.log(
    `${t.abbrev.padEnd(5)} ${String(t.remaining).padStart(4)}  ${String(t.remainingOffNight).padStart(3)}  ${String(t.backToBacks).padStart(3)}  ${avg(remaining.map((g) => g.opponentGaPerGame)).padStart(7)}  ${sched}`,
  );
}
console.log("\n* = off-night game. OppGA/G = opponents' goals allowed per game (higher is softer for skaters).");
