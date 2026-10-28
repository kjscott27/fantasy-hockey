/**
 * One-time check that your .env works: fetches each ESPN league view we rely on,
 * saves the raw JSON to data/raw/ (so the parsers can be built against your real
 * league), and prints a short summary.
 *
 *   npm run probe
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, PROJECT_ROOT, requireLeague } from "./config.ts";
import { EspnClient } from "./espn/client.ts";
import { SLOT_NAMES, statName } from "./espn/statMap.ts";

const config = requireLeague(loadConfig());
const espn = new EspnClient(config);
const rawDir = path.join(PROJECT_ROOT, "data", "raw");
await mkdir(rawDir, { recursive: true });

async function dump<T>(name: string, fetcher: () => Promise<T>): Promise<T> {
  const data = await fetcher();
  await writeFile(path.join(rawDir, `${name}.json`), JSON.stringify(data, null, 2));
  console.log(`  saved data/raw/${name}.json`);
  return data;
}

console.log(`Probing league ${config.leagueId}, season ${config.season}...`);

// Loosely typed on purpose: these files exist so we can see the real shapes.
const settings: any = await dump("settings", () => espn.league({ views: ["mSettings", "mStatus"] }));
const teams: any = await dump("teams", () => espn.league({ views: ["mTeam"] }));
await dump("rosters", () => espn.league({ views: ["mRoster"] }));
await dump("matchups", () => espn.league({ views: ["mMatchupScore", "mScoreboard"] }));
await dump("free-agents", () =>
  espn.league({
    views: ["kona_player_info"],
    params: { scoringPeriodId: settings.scoringPeriodId ?? 0 },
    filter: {
      players: {
        filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
        limit: 50,
        sortPercOwned: { sortPriority: 1, sortAsc: false },
      },
    },
  }),
);

const s = settings.settings ?? {};
const scoring = s.scoringSettings ?? {};
const slotCounts: Record<string, number> = s.rosterSettings?.lineupSlotCounts ?? {};

console.log(`\nLeague:        ${s.name ?? "(unknown)"}`);
console.log(`Scoring type:  ${scoring.scoringType ?? "(unknown)"}`);
console.log(
  `Categories:    ${(scoring.scoringItems ?? [])
    .map((i: any) => `${statName(i.statId)}${i.points ? `=${i.points}` : ""}${i.isReverseItem ? " (lower better)" : ""}`)
    .join(", ")}`,
);
console.log(
  `Lineup slots:  ${Object.entries(slotCounts)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${SLOT_NAMES[Number(id)] ?? `slot${id}`}x${n}`)
    .join(" ")}`,
);
console.log(`Current week:  matchup period ${settings.status?.currentMatchupPeriod ?? "?"}, scoring period ${settings.scoringPeriodId ?? "?"}`);

const swid = config.swid!.toUpperCase();
const myTeam =
  (teams.teams ?? []).find((t: any) => t.id === config.teamId) ??
  (teams.teams ?? []).find((t: any) => (t.owners ?? []).some((o: string) => o.toUpperCase() === swid));
const teamName = (t: any) => t.name ?? `${t.location ?? ""} ${t.nickname ?? ""}`.trim();

if (myTeam) {
  console.log(`Your team:     ${teamName(myTeam)} (id ${myTeam.id})${config.teamId ? "" : " - detected from SWID; set ESPN_TEAM_ID to pin it"}`);
} else {
  console.log("Your team:     not found. Set ESPN_TEAM_ID in .env (teamId= in your team page URL).");
}
console.log("\nProbe complete. Nothing was changed on ESPN (read-only requests only).");
