# fantasy-hockey

A read-only advisor for an ESPN fantasy hockey league. It pulls your league, the free-agent pool and the NHL schedule, then suggests lineup changes and drop/add swaps in an HTML report.

It **never makes moves**. Every ESPN request is a hard-coded `GET`, and no code touches transactions or lineups. You make every change yourself on ESPN.

- [Setup](#setup)
- [Commands](#commands)
- [A weekly routine](#a-weekly-routine)
- [Reading the report](#reading-the-report)
- [How the numbers are calculated](#how-the-numbers-are-calculated)
- [What the tool can't see](#what-the-tool-cant-see)
- [Troubleshooting](#troubleshooting)
- [Self-hosting on a Raspberry Pi](#self-hosting-on-a-raspberry-pi)
- [Project layout](#project-layout)

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
| `ESPN_TEAM_ID` | Optional. `teamId=` in the same URL. Detected from your SWID if blank. |
| `ESPN_SEASON` | The year the season ends (2026–27 = `2027`) |
| `ESPN_S2`, `ESPN_SWID` | On fantasy.espn.com while logged in: DevTools → Application → Cookies → `https://fantasy.espn.com`. Copy both values. Keep the curly braces on SWID. |

These cookies give access to your ESPN account. `.env` is git-ignored, so keep it that way and never paste the values anywhere public.

Check that it works:

```sh
npm run probe
```

You should see your league name, scoring type, lineup slots and team name.

## Commands

| Command | What it does | Needs login |
| --- | --- | --- |
| `npm run snapshot` | Fetches everything and runs the analysis. Writes `data/latest.json`, a dated copy and `reports/latest.html`, then prints a summary. | Yes |
| `npm run report` | Re-renders the HTML from `data/latest.json` without refetching | No |
| `npm run week` | Games left per NHL team this week, with off nights and back-to-backs | No |
| `npm run week -- --next` | The same for next week | No |
| `npm run scheduled` | `snapshot`, then emails the result if [email notifications](#email-notifications) are set up. Used by cron on the Pi. `-- --print` previews the email; `-- --force` sends even if today's success email went out. | Yes |
| `npm run probe` | Saves raw ESPN responses to `data/raw/` for debugging | Yes |
| `npm run typecheck` | TypeScript check | No |

Open the report with:

```sh
open reports/latest.html
```

The snapshot takes a few seconds. Snapshots and reports stay on your machine (`data/` and `reports/` are git-ignored).

## A weekly routine

**Every day, before the first game (around 6 pm ET)**

1. Run `npm run snapshot` and open the report.
2. Read the **Today** card. If it says to start or bench someone, make that change on ESPN.
3. Read any alerts, such as an injured player in your lineup or a healthy player stuck on IR.

**Before using an add**

1. Pick a top row from **Suggested swaps**.
2. Spend 30 seconds checking the incoming player's news on ESPN and the line combinations and confirmed goalies on Daily Faceoff. Is the player still on the same line and power-play unit, and healthy?
3. If nothing changes the picture, make the move. Adds are limited per matchup week, so favor rows with a large **Next wk** gain over one-week boosts.

**Sunday**

Waivers process on Sunday and the new matchup week starts Monday. Run `npm run week -- --next` to see which NHL teams play the most games, especially on off nights, and plan adds for the week ahead.

## Reading the report

### Top tiles

- **Record**: your win-loss record and league rank.
- **This week**: current matchup score.
- **Projected final**: current score plus each team's projected points for the rest of the week, assuming **both** teams set their best lineup every day.
- **Adds left**: acquisitions remaining this matchup week.
- **Points for**: your season total.

### Matchup

Solid bars are points scored so far; faded bars are projected points still to come. The line underneath gives the projected margin.

### Today

- **Start / Bench**: changes that would make today's lineup optimal. "Already optimal" means no changes are needed.
- **Alerts**:
  - an OUT or IR player in an active slot
  - a healthy player still on IR (ESPN blocks adds until this is fixed)
  - an injured player on your bench while an IR slot is open
  - day-to-day players to check before lineups lock

Lineups lock at each game's start time. Players whose game has already started are never suggested, because they can't be moved.

If the report is more than 90 minutes old when you open it, a yellow banner at the top says so. On a scheduled setup this usually means a refresh failed, for example because the ESPN cookies expired.

### Suggested swaps

Each row is "add this player, drop that one," ranked by projected points gained.

| Column | Meaning |
| --- | --- |
| **Gain** | Total projected points gained: this week + next week |
| **Add / Drop** | The swap. `WV` = on waivers, so the claim takes about a day to process. |
| **This wk** | Points gained over the rest of this week, with the lineup re-planned day by day |
| **Next wk** | Points gained over all of next week |
| **ROS/gm** | Difference in rest-of-season points per team game. Shows whether the upgrade lasts beyond two weeks. |
| **Usable** | First day the added player can be in your lineup |
| **Owned** | Percent of ESPN leagues that roster the player |

A swap can show a big gain even when the two players score similarly per game. That happens when the added player fills an empty lineup slot on days your roster has few games. If **ROS/gm** is small or negative, the gain is mostly about this schedule and won't last.

### Lineup plan

One card per remaining day with the best lineup from your current roster and each starter's expected points. **Benched with a game** lists players who play that day but don't fit the lineup. Those are points left on the table, and a sign of a crowded position.

### My roster and Free agents

| Column | Meaning |
| --- | --- |
| **Value** | Blended fantasy points per game; the number every decision uses (see below) |
| **Season / L7 / L15 / Proj** | Points per game this season, over the last 7 days, over the last 15 days, and in ESPN's projection |
| **Trend** | Last 15 days minus season. Green = heating up, red = cooling off. |
| **Starts** | Goalies only: expected share of their team's starts |
| **Left** | Games left this week (games on off nights in brackets) |
| **Pts** | Projected points this week if started in every game (ignores lineup conflicts) |
| **Next wk** | Games next week |
| **Δ** | Change in percent owned. A rising number often means news. |

Click any column header to sort. The free-agent table has position filters.

### NHL schedule

Every team's games this week. Shaded columns are **off nights** (7 or fewer games), when fewer of your players compete for lineup slots. Highlighted rows are teams you roster. **Left** and **Off** count games still to play.

### Opponent roster

Expand it to see your opponent's lineup and how many games they have left.

## How the numbers are calculated

### 1. Data

Each snapshot makes four read-only requests:

1. **Your ESPN league**: settings, all rosters and the matchup scores.
2. **ESPN free agents**: the top 150 free-agent and waiver players by percent owned.
3. **ESPN's NHL schedule**: every game and its date. ESPN counts each calendar day (US Eastern) as one "scoring period."
4. **NHL standings** (`api-web.nhle.com`): used for opponent strength in the schedule view.

### 2. Player value

ESPN already converts each player's stats into fantasy points using **your league's scoring**, separately for this season, the last 7, 15 and 30 days, and its projection. The tool blends four of those points-per-game figures:

| Source | Weight | Counts in full once the player has |
| --- | --- | --- |
| ESPN season projection | 35% | any projection (last season fills in if missing) |
| This season | 25% | 10 games |
| Last 15 days | 25% | 5 games |
| Last 7 days | 15% | 3 games |

Below the game threshold a source's weight shrinks in proportion, so a two-game hot streak can't dominate.

Example: a player with projection 5.17, season 8.53, last 15 days 8.69 and last 7 days 7.33, all with full samples:

```
0.35 × 5.17 + 0.25 × 8.53 + 0.25 × 8.69 + 0.15 × 7.33 = 7.21
```

Adjustments:

- **Goalies** are multiplied by their expected share of team starts. Early in the season that is mostly ESPN's projected starts; actual starts take over as the team plays more games (up to 60% weight after 20 games). A 3.84-point goalie expected to start 71% of games is worth 2.7 per team game.
- **Day-to-day** players count at 75%. **OUT, IR and suspended** players count as zero.

### 3. Daily lineup

For each remaining day the tool takes the players whose NHL team plays and finds the highest-scoring legal lineup for your league's slots, using each player's eligible positions. Adding up the days gives the rest-of-week projection. Comparing today's best lineup with your current one gives the **Today** suggestions.

Once a game starts, its players are locked. Their points from that game are already in ESPN's live score, so they add nothing more to the projection. A locked player in an active slot keeps that slot, and the rest of today's lineup is planned around them.

### 4. Matchup projection

Projected final = current score + rest-of-week projection, for both you and your opponent.

### 5. Swaps

The tool takes your six lowest-value droppable players (players on IR excluded) and the 40 best healthy free agents. For every pair, it removes the drop, adds the free agent, and re-plans this week and next week. The **Gain** is the difference from your current roster. Rules applied:

- **Add limit**: with no adds left this week, only next week counts.
- **Timing**: a free agent is usable from tomorrow, a waiver claim from the day after.
- **Position limits**, such as maximum goalies (players on IR don't count).

Swaps gaining under 0.5 points are hidden. Each free agent appears at most three times, and the top 15 are shown.

Two weeks rather than one because adds are capped per matchup. A one-game streamer rarely beats an upgrade that keeps paying off.

## What the tool can't see

The report is a model built on box-score data. Check these yourself before acting:

- **News**: line promotions, power-play changes, a goalie losing the net, or an injury ESPN hasn't flagged yet. A sudden drop in L15 (such as a goalie at 0.0) usually has a reason the numbers can't explain.
- **Tonight's goalie starters**: the model uses each goalie's usual share of starts. Check confirmed starters, because wins and shutouts are worth a lot.
- **Small samples**: early in the season a few big games can inflate a player's value.
- **Timing**: games that have started are left out of the projection, but a snapshot is only as current as when it ran. Rerun before deciding.
- **Out of scope**: trades, waiver priority, and players returning from IR who would push you over a position limit.
- **Free-agent pool**: only the top 150 free agents by percent owned are considered.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `ESPN returned 401/403` or `non-JSON` | Your cookies expired (logging out of ESPN does this). Copy fresh `espn_s2` and `SWID` values into `.env`. |
| `ESPN_LEAGUE_ID is not set` | Create `.env` from `.env.example` and fill it in. |
| `Couldn't find your team` | Set `ESPN_TEAM_ID` in `.env`. |
| Numbers look stale | Rerun `npm run snapshot`. `npm run report` only re-renders the last snapshot. |
| Pi report has a "may have failed" banner | Check your failure email, or `logs/snapshot.log` on the Pi. A 401/403 means the cookies expired. Update `.env` on the Pi. |
| Projection seems off for one player | Check that player's row: a missing projection or a tiny sample (low GP) is the usual cause. |

## Self-hosting on a Raspberry Pi

A Pi at home can refresh the report every hour and serve it to your phone from anywhere. These steps work on a Pi 3, 4 or 5. On a Pi 4 or 5, booting from a USB SSD is more reliable than an SD card.

Remote access uses [Tailscale](https://tailscale.com), a free private network between your own devices. The report gets an HTTPS address that only your devices can open. Nothing is exposed to the internet and you don't need to change any router settings.

**1. Install the OS.** With Raspberry Pi Imager, flash **Raspberry Pi OS Lite (64-bit)**. In Imager's settings, set a hostname (for example `hockey-pi`), a username, your wifi and SSH access. Boot the Pi and `ssh <user>@hockey-pi.local`.

**2. Set the timezone.** Cron's hours and the report's "Generated" time both use it.

```sh
sudo timedatectl set-timezone America/Toronto   # your zone; list them with: timedatectl list-timezones
```

**3. Install Node 22** from NodeSource, so `node` and `npm` are in `/usr/bin`, where cron can find them:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v
```

**4. Get the code and your `.env`.** Clone the repo (or `rsync` it from your computer), install, then copy `.env` over from your computer:

```sh
git clone git@github.com:kjscott27/fantasy-hockey.git ~/fantasy-hockey
cd ~/fantasy-hockey && npm ci
# on your computer:
scp .env <user>@hockey-pi.local:~/fantasy-hockey/.env
```

Check it works, and see how long a run takes:

```sh
npm run probe
time scripts/pi/run-snapshot.sh && tail logs/snapshot.log
```

**5. Schedule it.** Run `crontab -e` and add this line to refresh on the hour from 9:00 to 21:00:

```
0 9-21 * * * $HOME/fantasy-hockey/scripts/pi/run-snapshot.sh
```

Paste it as-is: cron expands `$HOME` to your home folder. Check it with `crontab -l`.

`scripts/pi/run-snapshot.sh` runs `npm run scheduled`, logs each run to `logs/snapshot.log` and skips a run if the previous one is still going. If a run fails, the previous report stays in place and the page shows its age. Set up [email notifications](#email-notifications) to hear about failures straight away.

**6. Serve it with Tailscale.**

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

In the [Tailscale admin console](https://login.tailscale.com/admin/dns), turn on **MagicDNS** and **HTTPS Certificates**. Then serve the reports folder in the background (this persists across reboots):

```sh
sudo tailscale serve --bg $HOME/fantasy-hockey/reports
tailscale serve status   # shows the URL
```

**7. Open it on your phone.** Install the Tailscale app, sign in with the same account and leave it connected. Open `https://hockey-pi.<your-tailnet>.ts.net/latest.html` and add it to your home screen.

**8. Optional: email notifications.** See [Email notifications](#email-notifications) below.

**Moving to a new Pi** later: repeat the steps on the new Pi and give it the same hostname (remove the old machine in the Tailscale console first). Your bookmark keeps working.

### Email notifications

Scheduled runs can email you:

- **Every failure, straight away**, saying what went wrong, why and how to fix it, plus the technical details.
- **One success email a day**, after the first good run, with the matchup score, today's lineup changes, alerts, the top 5 swaps and a link to the report. You also get one on the first good run after a failure.

Emails are sent through Gmail from a **dedicated sender account** that you create just for this. The Pi has to store that account's App Password in `.env`. An App Password can send mail and read the whole inbox, but it can't change the account's password or settings. With a dedicated account, a leaked `.env` exposes an empty inbox instead of your real one.

1. Create a new Gmail account, for example `yournamepinotifications@gmail.com`.
2. On that account, turn on [2-Step Verification](https://myaccount.google.com/signinoptions/twosv). Google only allows App Passwords with 2-Step Verification on, and it no longer accepts a plain password for sending mail from scripts.
3. Create an App Password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (name it "hockey pi"). Copy the 16 characters; you can't view them again.
4. Add these to your `.env` (see `.env.example`):

   ```sh
   NOTIFY_GMAIL_USER=yournamepinotifications@gmail.com
   NOTIFY_GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
   NOTIFY_EMAIL_TO=you@gmail.com
   REPORT_URL=https://hockey-pi.<your-tailnet>.ts.net/latest.html
   ```

5. Copy `.env` to the Pi and lock down its permissions:

   ```sh
   scp .env <user>@hockey-pi:~/fantasy-hockey/.env
   ssh <user>@hockey-pi 'chmod 600 ~/fantasy-hockey/.env'
   ```

6. On the Pi, preview the email, then send a real one:

   ```sh
   cd ~/fantasy-hockey
   npm run scheduled -- --print   # prints the email, sends nothing
   npm run scheduled -- --force   # sends it even if today's success email already went out
   ```

7. In your main Gmail, open the email and use **⋮ → Filter messages like this → Never send it to Spam**, so a failure email never lands in Spam.

To turn emails off, blank out the `NOTIFY_*` values. To revoke access, delete the App Password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).

Each failure email starts with a code:

| Code | Meaning | Usual fix |
| --- | --- | --- |
| `ESPN_AUTH` | ESPN rejected the cookies | Copy fresh `espn_s2` and `SWID` into `.env` and `scp` it to the Pi |
| `ESPN_UNAVAILABLE` | ESPN returned 429 or 5xx | None. The next run retries. |
| `ESPN_NOT_FOUND` | ESPN returned 404 | Check `ESPN_LEAGUE_ID` and `ESPN_SEASON` |
| `ESPN_FORMAT` | ESPN's data changed shape | The code needs updating. `npm run probe` saves raw responses. |
| `NHL_API` | NHL standings request failed | None. The next run retries. |
| `NETWORK` | The Pi couldn't reach the internet | Check the Pi's wifi |
| `TIMEOUT` | A request took over 30 seconds | None if it's a one-off; otherwise check the wifi signal |
| `CONFIG_MISSING` | A required `.env` value is blank | Fill it in |
| `TEAM_NOT_FOUND` | Your team wasn't found in the league | Set `ESPN_TEAM_ID` |
| `DISK` | Couldn't write the report | `df -h`: the card may be full or failing |
| `UNKNOWN` | Anything else | The email includes the stack trace; see `logs/snapshot.log` |

If the email itself can't be sent, the run exits with code 2 and `logs/snapshot.log` shows the Gmail error. `EAUTH` means the sender address or App Password is wrong. Emails can't be sent at all if Node can't start (for example, `npm` is missing). In that case the report's stale banner is the only warning.

## Project layout

```
src/
  config.ts             .env loading
  errors.ts             error codes and their explanations for failure emails
  espn/client.ts        GET-only ESPN client
  espn/league.ts        league, roster, matchup and free-agent parsing
  espn/proSchedule.ts   NHL schedule from ESPN, scoring period <-> date
  espn/statMap.ts       ESPN stat and slot IDs (checked against NHL stats)
  nhl/client.ts         NHL standings
  analysis/week.ts      games per team, off nights, back-to-backs
  analysis/value.ts     points-per-game blend, goalie start share, injuries
  analysis/lineup.ts    daily lineup optimizer
  analysis/suggest.ts   swaps, today's changes, alerts
  snapshot.ts           npm run snapshot
  scheduled.ts          npm run scheduled: snapshot + email
  notify/email.ts       success/failure emails, sent through Gmail
  snapshotTypes.ts      shape of data/latest.json
  report/template.ts    HTML report
  report.ts             npm run report
  weekCli.ts            npm run week
  probe.ts              npm run probe
scripts/pi/
  run-snapshot.sh       cron wrapper for scheduled snapshots on a Pi
```

`data/latest.json` contains everything in the report in machine-readable form, useful for your own analysis or scripts.

## Data sources

- ESPN fantasy API (unofficial and undocumented; may change without notice): `lm-api-reads.fantasy.espn.com/apis/v3/games/fhl`
- NHL API: `api-web.nhle.com/v1`
