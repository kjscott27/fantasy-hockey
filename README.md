# fantasy-hockey

A read-only advisor for an ESPN fantasy hockey league. It pulls your league, the free-agent pool and the NHL schedule, then suggests lineup changes and drop/add swaps. It **never** makes moves: every ESPN request is a hard-coded `GET`, and there's no code that touches transactions or lineups.

## Setup

Requires Node 22+.

```sh
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Where to find it |
| --- | --- |
| `ESPN_LEAGUE_ID` | `leagueId=` in your ESPN team page URL |
| `ESPN_TEAM_ID` | Optional. `teamId=` in the same URL; detected from your SWID if blank |
| `ESPN_SEASON` | The year the season ends (2026–27 = `2027`) |
| `ESPN_S2`, `ESPN_SWID` | On fantasy.espn.com while logged in: DevTools → Application → Cookies. Keep the braces on SWID. |

The cookies grant access to your ESPN account. `.env` is git-ignored; keep it that way. They expire if you log out of ESPN.

## Commands

| Command | What it does |
| --- | --- |
| `npm run snapshot` | Fetches everything, writes `data/latest.json` (plus a dated copy) and `reports/latest.html`, and prints a summary |
| `npm run report` | Re-renders the HTML from `data/latest.json` without refetching |
| `npm run week` | Games left per NHL team this week, with off nights and back-to-backs. Add `-- --next` for next week. No login needed. |
| `npm run probe` | Dumps raw ESPN responses to `data/raw/` for debugging |

Open the report with `open reports/latest.html`.

## How the numbers work

- **Points per game** come straight from ESPN under your league's scoring. Each player's value blends ESPN's season projection (35%), this season (25%), the last 15 days (25%) and the last 7 days (15%). Each part counts for less until it has enough games. Without a projection, last season's numbers fill in.
- **Goalies** are scaled by their expected share of team starts.
- **Injuries:** day-to-day players are discounted 25%. OUT, IR and suspended players count as zero.
- **Lineups** are optimized for each remaining day using the real NHL schedule and your league's slots, so a player who would sit on your bench adds nothing.
- **Swaps** are ranked by lineup-optimized points gained over the rest of this week plus all of next week. They respect the weekly add limit, roster position limits and waiver delays.

## Data sources

- ESPN fantasy API (unofficial): `lm-api-reads.fantasy.espn.com/apis/v3/games/fhl`
- NHL API: `api-web.nhle.com/v1` for standings and opponent strength
