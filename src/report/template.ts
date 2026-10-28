import type { Snapshot, SnapshotPlayer } from "../snapshotTypes.ts";

const SLOT_ORDER = ["C", "LW", "RW", "F", "D", "UTIL", "G", "BN", "IR"];

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const num = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? "–" : n.toFixed(digits));
const signed = (n: number, digits = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

const weekday = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** A table cell with an explicit sort key. */
const td = (content: string, sort?: number | string, cls = "") =>
  `<td${cls ? ` class="${cls}"` : ""}${sort !== undefined ? ` data-sort="${esc(String(sort))}"` : ""}>${content}</td>`;

function injuryBadge(status: string): string {
  if (status === "ACTIVE" || status === "NORMAL") return "";
  const label = status === "DAY_TO_DAY" ? "DTD" : status === "INJURY_RESERVE" ? "IR" : status === "SUSPENSION" ? "SUSP" : status;
  return ` <span class="badge ${status === "DAY_TO_DAY" ? "warn" : "bad"}">${esc(label)}</span>`;
}

const playerName = (p: SnapshotPlayer) => `<span class="name">${esc(p.name)}</span>${injuryBadge(p.injuryStatus)}`;

function trendCell(p: SnapshotPlayer): string {
  const recent = p.ppg.last15 ?? p.ppg.last7;
  if (recent === null || p.ppg.season === null) return td("–", -99);
  const diff = recent - p.ppg.season;
  const cls = diff > 0.5 ? "pos" : diff < -0.5 ? "neg" : "muted";
  return td(signed(diff), diff, cls);
}

function rosterTable(players: SnapshotPlayer[]): string {
  const sorted = [...players].sort(
    (a, b) => SLOT_ORDER.indexOf(a.lineupSlot ?? "BN") - SLOT_ORDER.indexOf(b.lineupSlot ?? "BN") || b.ppg.value - a.ppg.value,
  );
  const rows = sorted
    .map(
      (p) => `<tr>
      ${td(esc(p.lineupSlot ?? ""), SLOT_ORDER.indexOf(p.lineupSlot ?? "BN"), "slot")}
      ${td(playerName(p), p.name)}
      ${td(esc(p.eligible.join("/") || p.position), p.position)}
      ${td(esc(p.team), p.team)}
      ${td(num(p.ppg.value, 2), p.ppg.value, "strong")}
      ${td(num(p.ppg.season), p.ppg.season ?? -1)}
      ${td(num(p.ppg.last7), p.ppg.last7 ?? -1)}
      ${td(num(p.ppg.last15), p.ppg.last15 ?? -1)}
      ${td(num(p.ppg.projected), p.ppg.projected ?? -1)}
      ${trendCell(p)}
      ${td(p.startShare === null ? "" : pct(p.startShare), p.startShare ?? -1)}
      ${td(`${p.thisWeek.gamesLeft}${p.thisWeek.offNightGamesLeft ? ` <span class="muted">(${p.thisWeek.offNightGamesLeft} off)</span>` : ""}`, p.thisWeek.gamesLeft)}
      ${td(num(p.thisWeek.projectedPoints), p.thisWeek.projectedPoints)}
      ${td(String(p.nextWeek.games), p.nextWeek.games)}
    </tr>`,
    )
    .join("");
  return `<div class="table-wrap"><table class="sortable">
    <thead><tr>
      <th>Slot</th><th>Player</th><th>Pos</th><th>Team</th>
      <th title="Blended points per game used for decisions">Value</th>
      <th>Season</th><th>L7</th><th>L15</th><th>Proj</th>
      <th title="Last 15 days vs season, points per game">Trend</th>
      <th title="Goalies: expected share of team starts">Starts</th>
      <th title="Games left this week (off-night games)">Left</th>
      <th title="Projected points rest of week, if started every game">Pts</th>
      <th>Next wk</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function freeAgentTable(players: SnapshotPlayer[]): string {
  const rows = players
    .map(
      (p) => `<tr data-pos="${esc(p.position)}">
      ${td(playerName(p) + (p.status === "WAIVERS" ? ' <span class="badge">WV</span>' : ""), p.name)}
      ${td(esc(p.eligible.join("/") || p.position), p.position)}
      ${td(esc(p.team), p.team)}
      ${td(num(p.ppg.value, 2), p.ppg.value, "strong")}
      ${td(num(p.ppg.season), p.ppg.season ?? -1)}
      ${td(num(p.ppg.last7), p.ppg.last7 ?? -1)}
      ${td(num(p.ppg.last15), p.ppg.last15 ?? -1)}
      ${td(num(p.ppg.projected), p.ppg.projected ?? -1)}
      ${trendCell(p)}
      ${td(p.startShare === null ? "" : pct(p.startShare), p.startShare ?? -1)}
      ${td(String(p.thisWeek.gamesLeft), p.thisWeek.gamesLeft)}
      ${td(String(p.nextWeek.games), p.nextWeek.games)}
      ${td(`${num(p.percentOwned, 0)}%`, p.percentOwned)}
      ${td(signed(p.percentChange), p.percentChange, p.percentChange > 1 ? "pos" : p.percentChange < -1 ? "neg" : "muted")}
    </tr>`,
    )
    .join("");
  return `<div class="filters" role="group" aria-label="Filter by position">
      ${["All", "C", "LW", "RW", "D", "G"].map((p, i) => `<button type="button" data-filter="${p}"${i === 0 ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${p}</button>`).join("")}
    </div>
    <div class="table-wrap"><table class="sortable" id="fa-table">
    <thead><tr>
      <th>Player</th><th>Pos</th><th>Team</th><th>Value</th><th>Season</th><th>L7</th><th>L15</th><th>Proj</th>
      <th>Trend</th><th>Starts</th><th>Left</th><th>Next wk</th><th>Owned</th><th title="Change in % owned">Δ</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function swapTable(s: Snapshot): string {
  if (s.swaps.length === 0) return `<p class="muted">No swap clears the bar right now. Your roster beats the top free agents over the next two weeks.</p>`;
  const rows = s.swaps
    .map(
      (w) => `<tr>
      ${td(signed(w.totalGain), w.totalGain, "strong pos")}
      ${td(`<span class="name">${esc(w.add.name)}</span> <span class="muted">${esc(w.add.position)} · ${esc(w.add.team)}</span>${w.add.status === "WAIVERS" ? ' <span class="badge">WV</span>' : ""}`, w.add.name)}
      ${td(`<span class="name">${esc(w.drop.name)}</span> <span class="muted">${esc(w.drop.position)} · ${esc(w.drop.team)}</span>`, w.drop.name)}
      ${td(signed(w.thisWeekGain), w.thisWeekGain)}
      ${td(signed(w.nextWeekGain), w.nextWeekGain)}
      ${td(signed(w.rosDiff, 2), w.rosDiff, w.rosDiff > 0 ? "pos" : "neg")}
      ${td(`${weekday(w.usableFrom)} ${shortDate(w.usableFrom)}`, w.usableFrom)}
      ${td(`${num(w.add.percentOwned, 0)}%`, w.add.percentOwned)}
    </tr>`,
    )
    .join("");
  return `<div class="table-wrap"><table class="sortable swaps">
    <thead><tr>
      <th title="Projected points gained: rest of this week + next week">Gain</th><th>Add</th><th>Drop</th>
      <th>This wk</th><th>Next wk</th><th title="Rest-of-season points per team game">ROS/gm</th><th>Usable</th><th>Owned</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function lineupPlan(s: Snapshot): string {
  if (s.lineupPlan.length === 0) return `<p class="muted">No games left this week.</p>`;
  return `<div class="days">${s.lineupPlan
    .map((d) => {
      const starters = [...d.starters].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
      const isToday = d.date === s.week.today;
      return `<article class="day${isToday ? " today" : ""}">
        <header><strong>${weekday(d.date)} ${shortDate(d.date)}</strong>${isToday ? ' <span class="badge accent">Today</span>' : ""}<span class="day-total">${num(d.total)} pts</span></header>
        ${
          starters.length
            ? `<ul class="starters">${starters.map((p) => `<li><span class="slot">${p.slot}</span> ${esc(p.name)} <span class="muted">${num(p.value)}</span></li>`).join("")}</ul>`
            : `<p class="muted">Nobody plays.</p>`
        }
        ${
          d.benchedWithGame.length
            ? `<p class="bench">Benched with a game: ${d.benchedWithGame.map((b) => `${esc(b.name)} <span class="muted">${num(b.value)}</span>`).join(", ")}</p>`
            : ""
        }
      </article>`;
    })
    .join("")}</div>`;
}

function scheduleGrid(s: Snapshot): string {
  const head = s.week.days
    .map((d) => `<th class="${d.offNight ? "off" : ""}${d.remaining ? "" : " played"}" title="${d.games} games">${weekday(d.date)}<br><span class="muted">${d.games}</span></th>`)
    .join("");
  const rosteredTeams = new Set(s.myRoster.map((p) => p.team));
  const rows = s.schedule
    .map((t) => {
      const cells = s.week.days
        .map((d) => {
          const g = t.games.find((x) => x.date === d.date);
          if (!g) return `<td class="${d.remaining ? "" : "played"}"></td>`;
          return `<td class="game${g.offNight ? " off" : ""}${g.remaining ? "" : " played"}">${g.home ? "" : "@"}${esc(g.opponent)}</td>`;
        })
        .join("");
      return `<tr${rosteredTeams.has(t.team) ? ' class="mine"' : ""}>
        ${td(`<strong>${esc(t.team)}</strong>`, t.team)}${td(String(t.gamesLeft), t.gamesLeft, "strong")}${td(String(t.offNightGamesLeft), t.offNightGamesLeft)}${cells}${td(String(t.nextWeekGames), t.nextWeekGames)}
      </tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="sortable grid">
    <thead><tr><th>Team</th><th>Left</th><th>Off</th>${head}<th>Next wk</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small">Shaded columns are off nights (7 or fewer games): fewer lineup conflicts. Highlighted rows are teams you roster.</p>`;
}

function matchupCard(s: Snapshot): string {
  const m = s.matchup;
  if (!m) return "";
  const myFinal = m.myPoints + m.myProjectedRest;
  const oppFinal = m.opponentPoints + m.opponentProjectedRest;
  const max = Math.max(myFinal, oppFinal, 1);
  const bar = (label: string, now: number, rest: number, cls: string) => `
    <div class="bar-row">
      <div class="bar-label">${esc(label)}</div>
      <div class="bar" role="img" aria-label="${esc(label)}: ${num(now)} now, ${num(now + rest)} projected">
        <span class="seg now ${cls}" style="width:${(now / max) * 100}%"></span><span class="seg rest ${cls}" style="width:${(rest / max) * 100}%"></span>
      </div>
      <div class="bar-value"><strong>${num(now)}</strong> <span class="muted">→ ${num(now + rest)}</span></div>
    </div>`;
  const lead = myFinal - oppFinal;
  return `<section class="card">
    <h2>Matchup ${s.week.matchupPeriod}: vs ${esc(m.opponent.name)}</h2>
    ${bar(s.myTeam.name, m.myPoints, m.myProjectedRest, "me")}
    ${bar(m.opponent.name, m.opponentPoints, m.opponentProjectedRest, "opp")}
    <p class="${lead >= 0 ? "pos" : "neg"}"><strong>Projected ${lead >= 0 ? "win" : "loss"} by ${num(Math.abs(lead))}</strong> <span class="muted">(both lineups set optimally for the rest of the week)</span></p>
  </section>`;
}

function todayCard(s: Snapshot): string {
  const changes = s.todayChanges.length
    ? `<ul class="actions">${s.todayChanges.map((c) => `<li><span class="badge ${c.action === "start" ? "good" : ""}">${c.action === "start" ? "Start" : "Bench"}</span> ${esc(c.name)}${c.slot ? ` <span class="muted">(${c.slot})</span>` : ""}</li>`).join("")}</ul>`
    : `<p class="muted">Today's lineup is already optimal.</p>`;
  const alerts = s.alerts.length
    ? `<ul class="alerts">${s.alerts.map((a) => `<li class="${a.level}">${esc(a.message)}</li>`).join("")}</ul>`
    : "";
  return `<section class="card">
    <h2>Today · ${weekday(s.week.today)} ${shortDate(s.week.today)}</h2>
    ${changes}${alerts}
    <p class="muted small">Lineups lock at each game's start; check that the game hasn't begun.</p>
  </section>`;
}

export function renderReport(s: Snapshot): string {
  const record = `${s.myTeam.wins}-${s.myTeam.losses}${s.myTeam.ties ? `-${s.myTeam.ties}` : ""}`;
  const standingRank = s.standings.findIndex((t) => t.id === s.myTeam.id) + 1;
  const addsLeft = s.acquisitions.remaining === null ? "∞" : String(s.acquisitions.remaining);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.myTeam.name)} · Week ${s.week.matchupPeriod}</title>
<style>
:root {
  --bg: #f6f7f9; --surface: #ffffff; --surface-2: #f0f2f5; --border: #e2e5ea;
  --text: #16191d; --muted: #66707c; --accent: #2457d6; --accent-soft: #e6edfc;
  --pos: #137a3f; --neg: #c02a2a; --warn: #9a6200; --warn-soft: #fdf3dc; --bad-soft: #fbe5e5; --good-soft: #e3f4ea;
  --me: #2457d6; --opp: #8a5cd0; --off: #eef3fd; --mine: #fffbe8;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f1215; --surface: #171b20; --surface-2: #1e2329; --border: #2a3038;
    --text: #e8ebef; --muted: #96a0ab; --accent: #7aa2ff; --accent-soft: #1d2a47;
    --pos: #4cc98a; --neg: #ff7b7b; --warn: #f0b75a; --warn-soft: #3a2e14; --bad-soft: #3d1c1c; --good-soft: #16352a;
    --me: #7aa2ff; --opp: #b896f0; --off: #18233a; --mine: #2c2a18;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0f1215; --surface: #171b20; --surface-2: #1e2329; --border: #2a3038;
  --text: #e8ebef; --muted: #96a0ab; --accent: #7aa2ff; --accent-soft: #1d2a47;
  --pos: #4cc98a; --neg: #ff7b7b; --warn: #f0b75a; --warn-soft: #3a2e14; --bad-soft: #3d1c1c; --good-soft: #16352a;
  --me: #7aa2ff; --opp: #b896f0; --off: #18233a; --mine: #2c2a18;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; font-variant-numeric: tabular-nums; }
main { max-width: 1240px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 24px; margin: 0; }
h2 { font-size: 16px; margin: 0 0 12px; }
.sub { color: var(--muted); margin: 4px 0 20px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.tile .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.tile .value { font-size: 22px; font-weight: 650; margin-top: 2px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 16px; min-width: 0; }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.pos { color: var(--pos); }
.neg { color: var(--neg); }
.strong { font-weight: 650; }
.badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: var(--surface-2); color: var(--muted); vertical-align: 1px; }
.badge.warn { background: var(--warn-soft); color: var(--warn); }
.badge.bad { background: var(--bad-soft); color: var(--neg); }
.badge.good { background: var(--good-soft); color: var(--pos); }
.badge.accent { background: var(--accent-soft); color: var(--accent); }
.table-wrap { overflow-x: auto; margin: 0 -16px; padding: 0 16px; }
table { border-collapse: collapse; width: 100%; white-space: nowrap; }
th, td { padding: 6px 8px; text-align: right; border-bottom: 1px solid var(--border); }
th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
table.swaps th:nth-child(3), table.swaps td:nth-child(3) { text-align: left; }
th { font-size: 12px; color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--surface); }
table.sortable th { cursor: pointer; user-select: none; }
table.sortable th[aria-sort="ascending"]::after { content: " ▲"; }
table.sortable th[aria-sort="descending"]::after { content: " ▼"; }
tbody tr:hover { background: var(--surface-2); }
td.slot, .slot { font-weight: 600; color: var(--muted); font-size: 12px; }
.name { font-weight: 550; }
.bar-row { display: grid; grid-template-columns: minmax(90px, 200px) 1fr auto; gap: 12px; align-items: center; margin-bottom: 10px; }
.bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { display: flex; height: 14px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.seg.now.me { background: var(--me); } .seg.rest.me { background: var(--me); opacity: .35; }
.seg.now.opp { background: var(--opp); } .seg.rest.opp { background: var(--opp); opacity: .35; }
ul.actions, ul.alerts, ul.starters { list-style: none; padding: 0; margin: 0 0 8px; }
ul.actions li, ul.alerts li { padding: 4px 0; }
ul.alerts li { padding-left: 12px; border-left: 3px solid var(--border); margin-bottom: 6px; }
ul.alerts li.warn { border-color: var(--warn); }
.days { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.day { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
.day.today { border-color: var(--accent); }
.day header { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.day-total { margin-left: auto; font-weight: 650; }
.starters li { padding: 2px 0; }
.starters .slot { display: inline-block; width: 26px; }
.bench { font-size: 12px; color: var(--warn); margin: 6px 0 0; }
.filters { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.filters button { font: inherit; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
.filters button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--surface); }
table.grid td.game { text-align: center; font-size: 12px; }
table.grid th:nth-child(n+4) { text-align: center; }
table.grid .off { background: var(--off); }
table.grid .played { opacity: .45; }
table.grid tr.mine td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
table.grid tr.mine { background: var(--mine); }
details summary { cursor: pointer; color: var(--muted); }
.stale { background: var(--warn-soft); color: var(--warn); border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; font-weight: 550; }
footer { color: var(--muted); font-size: 12px; margin-top: 24px; }
</style>
</head>
<body>
<main data-generated="${esc(s.generatedAt)}">
  <div class="stale" id="stale" hidden></div>
  <h1>${esc(s.myTeam.name)}</h1>
  <p class="sub">${esc(s.league.name)} · ${esc(s.week.label)} · Generated ${new Date(s.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>

  <div class="tiles">
    <div class="tile"><div class="label">Record</div><div class="value">${record}</div><div class="muted small">${standingRank}${["th", "st", "nd", "rd"][standingRank] ?? "th"} of ${s.standings.length}</div></div>
    ${
      s.matchup
        ? `<div class="tile"><div class="label">This week</div><div class="value">${num(s.matchup.myPoints)} – ${num(s.matchup.opponentPoints)}</div><div class="muted small">vs ${esc(s.matchup.opponent.abbrev)}</div></div>
    <div class="tile"><div class="label">Projected final</div><div class="value">${num(s.matchup.myPoints + s.matchup.myProjectedRest)} – ${num(s.matchup.opponentPoints + s.matchup.opponentProjectedRest)}</div><div class="muted small">optimal lineups</div></div>`
        : ""
    }
    <div class="tile"><div class="label">Adds left</div><div class="value">${addsLeft}</div><div class="muted small">of ${s.acquisitions.limit < 0 ? "∞" : s.acquisitions.limit} this matchup</div></div>
    <div class="tile"><div class="label">Points for</div><div class="value">${num(s.myTeam.pointsFor)}</div><div class="muted small">season</div></div>
  </div>

  <div class="cols">
    ${matchupCard(s)}
    ${todayCard(s)}
  </div>

  <section class="card">
    <h2>Suggested swaps</h2>
    ${swapTable(s)}
  </section>

  <section class="card">
    <h2>Lineup plan · rest of week</h2>
    ${lineupPlan(s)}
  </section>

  <section class="card">
    <h2>My roster</h2>
    ${rosterTable(s.myRoster)}
  </section>

  <section class="card">
    <h2>Free agents</h2>
    ${freeAgentTable(s.freeAgents)}
  </section>

  <section class="card">
    <h2>NHL schedule · ${esc(s.week.label)}</h2>
    ${scheduleGrid(s)}
  </section>

  ${
    s.matchup
      ? `<section class="card"><details><summary>Opponent roster: ${esc(s.matchup.opponent.name)}</summary>${rosterTable(s.opponentRoster)}</details></section>`
      : ""
  }

  <section class="card">
    <details><summary>How the numbers work</summary>
      <ul>${s.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
      <p class="muted small">Scoring: ${s.league.scoring.map((x) => `${esc(x.stat)} ${x.points}`).join(" · ")}</p>
    </details>
  </section>

  <footer>Suggestions only. Make all roster moves yourself on ESPN.</footer>
</main>
<script>
// Hourly refreshes run during the day. If this page is older than that, a refresh failed
// (often expired ESPN cookies) or it's outside the refresh window.
(() => {
  const generated = Date.parse(document.querySelector("main").dataset.generated);
  const hours = (Date.now() - generated) / 3_600_000;
  if (!(hours > 1.5)) return;
  const banner = document.getElementById("stale");
  const age = hours < 48 ? Math.floor(hours) + " hours" : Math.floor(hours / 24) + " days";
  banner.textContent = "This report is " + age + " old. The last refresh may have failed; projections and lineup advice may be out of date.";
  banner.hidden = false;
})();
document.querySelectorAll("table.sortable").forEach((table) => {
  table.querySelectorAll("thead th").forEach((th, col) => {
    th.addEventListener("click", () => {
      const desc = th.getAttribute("aria-sort") !== "descending";
      table.querySelectorAll("thead th").forEach((h) => h.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", desc ? "descending" : "ascending");
      const body = table.tBodies[0];
      const key = (tr) => {
        const cell = tr.children[col];
        const raw = cell?.dataset.sort ?? cell?.textContent ?? "";
        const n = Number(raw);
        return raw !== "" && !Number.isNaN(n) ? n : raw.toLowerCase();
      };
      [...body.rows]
        .sort((a, b) => {
          const x = key(a), y = key(b);
          const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
          return desc ? -cmp : cmp;
        })
        .forEach((tr) => body.appendChild(tr));
    });
  });
});
document.querySelectorAll(".filters button").forEach((btn) => {
  btn.addEventListener("click", () => {
    btn.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    const pos = btn.dataset.filter;
    document.querySelectorAll("#fa-table tbody tr").forEach((tr) => {
      tr.hidden = pos !== "All" && tr.dataset.pos !== pos;
    });
  });
});
</script>
</body>
</html>`;
}
