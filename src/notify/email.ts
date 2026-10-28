/**
 * Plain-text notification emails for scheduled runs, sent through Gmail SMTP from a
 * dedicated sender account. Laid out to read well on a phone.
 */
import nodemailer from "nodemailer";
import type { EmailConfig } from "../config.ts";
import type { FailureDescription } from "../errors.ts";
import type { Snapshot } from "../snapshotTypes.ts";

export interface Email {
  subject: string;
  text: string;
}

const SWAPS_SHOWN = 5;

const num = (n: number) => n.toFixed(1);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${num(Math.abs(n))}`;
const when = (iso: string | Date) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? "th"}`;

export function successEmail(s: Snapshot, opts: { reportUrl: string | null; recoveredAfter: number }): Email {
  const lines: string[] = [];
  let subject = "Hockey report ✓";

  if (opts.recoveredAfter > 0) {
    lines.push(`Back to normal after ${opts.recoveredAfter} failed run${opts.recoveredAfter === 1 ? "" : "s"}.`, "");
  }

  const m = s.matchup;
  if (m) {
    const myFinal = m.myPoints + m.myProjectedRest;
    const oppFinal = m.opponentPoints + m.opponentProjectedRest;
    subject += ` ${num(m.myPoints)}–${num(m.opponentPoints)} vs ${m.opponent.name}`;
    lines.push(
      `${s.myTeam.name} vs ${m.opponent.name}`,
      `Now ${num(m.myPoints)} – ${num(m.opponentPoints)} · projected final ${num(myFinal)} – ${num(oppFinal)} (${signed(myFinal - oppFinal)})`,
    );
  } else {
    lines.push(`${s.myTeam.name} · ${s.week.label}`);
  }

  lines.push("", "TODAY");
  if (s.todayChanges.length === 0) lines.push("Lineup already optimal");
  for (const c of s.todayChanges) lines.push(`${c.action === "start" ? "Start" : "Bench"} ${c.name}${c.slot ? ` (${c.slot})` : ""}`);

  if (s.alerts.length > 0) {
    lines.push("", "ALERTS");
    for (const a of s.alerts) lines.push(`${a.level === "warn" ? "⚠" : "•"} ${a.message}`);
  }

  const left = s.acquisitions.remaining;
  const adds = left === null ? "unlimited adds" : left === 0 ? "no adds left, so gains count next week only" : `${left} add${left === 1 ? "" : "s"} left`;
  lines.push("", `TOP SWAPS (2-week gain) · ${adds}`);
  if (s.swaps.length === 0) lines.push("No swaps worth making right now.");
  for (const w of s.swaps.slice(0, SWAPS_SHOWN)) {
    const waivers = w.add.status === "WAIVERS" ? ", waivers" : "";
    lines.push(`+${num(w.totalGain)}  Add ${w.add.name} (${w.add.position}, ${w.add.team}${waivers}) · drop ${w.drop.name}`);
  }

  lines.push("");
  if (opts.reportUrl) lines.push(`Full report: ${opts.reportUrl}`);
  lines.push(`Generated ${when(s.generatedAt)}. Next success email tomorrow; failures are always emailed.`);

  return { subject, text: lines.join("\n") };
}

export function failureEmail(
  f: FailureDescription,
  opts: { runAt: Date; consecutive: number; lastGood: Snapshot | null; reportUrl: string | null },
): Email {
  const lines = [
    "WHAT HAPPENED",
    `The ${when(opts.runAt)} refresh failed: ${f.title}.`,
    opts.consecutive > 1 ? `This is the ${ordinal(opts.consecutive)} failure in a row.` : "",
    "",
    "WHY",
    f.why,
    "",
    "HOW TO FIX",
    ...f.fix.map((step, i) => `${i + 1}. ${step}`),
    "",
    "THE REPORT",
    opts.lastGood
      ? `Still shows the last good refresh from ${when(opts.lastGood.generatedAt)}.${opts.reportUrl ? ` ${opts.reportUrl}` : ""}`
      : "No earlier report exists yet.",
    "",
    "DETAILS",
    `Code: ${f.code}`,
    ...Object.entries(f.details).map(([k, v]) => `${k}: ${v}`),
  ];
  return { subject: `Hockey report ✗ ${f.title}`, text: lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n") };
}

export async function sendEmail(config: EmailConfig, email: Email): Promise<void> {
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: config.user, pass: config.appPassword },
  });
  await transport.sendMail({ from: `Fantasy hockey Pi <${config.user}>`, to: config.to, subject: email.subject, text: email.text });
}
