/**
 * Scheduled snapshot for cron: runs the snapshot, then emails the result. Every failure
 * is emailed; success once a day, and again on the first good run after a failure.
 *
 *   npm run scheduled              # run and email
 *   npm run scheduled -- --print   # print the email instead of sending it (state untouched)
 *   npm run scheduled -- --force   # send the success email even if one already went out today
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, PROJECT_ROOT } from "./config.ts";
import { describeFailure, type FailureDescription } from "./errors.ts";
import { failureEmail, sendEmail, successEmail, type Email } from "./notify/email.ts";
import type { Snapshot } from "./snapshotTypes.ts";

interface NotifyState {
  /** Pi-local YYYY-MM-DD of the last success email sent. */
  lastSuccessEmailDate: string | null;
  consecutiveFailures: number;
}

const print = process.argv.includes("--print");
const force = process.argv.includes("--force");

const config = loadConfig();
const statePath = path.join(PROJECT_ROOT, "data", "notify-state.json");
const latestPath = path.join(PROJECT_ROOT, "data", "latest.json");

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

const state: NotifyState = (await readJson<NotifyState>(statePath)) ?? { lastSuccessEmailDate: null, consecutiveFailures: 0 };
const runAt = new Date();
const localDate = runAt.toLocaleDateString("en-CA"); // YYYY-MM-DD in the Pi's timezone

let failure: FailureDescription | null = null;
try {
  // snapshot.ts is a top-level script; a throw anywhere in it rejects this import.
  await import("./snapshot.ts");
} catch (err) {
  failure = describeFailure(err);
  console.error(`\nSnapshot failed [${failure.code}]: ${failure.title}`);
  console.error(err);
}

const latest = await readJson<Snapshot>(latestPath);
if (!failure && !latest) failure = describeFailure(new Error("Snapshot finished but data/latest.json couldn't be read"));

let email: Email | null = null;
if (failure) {
  email = failureEmail(failure, { runAt, consecutive: state.consecutiveFailures + 1, lastGood: latest, reportUrl: config.reportUrl });
} else if (print || force || state.consecutiveFailures > 0 || state.lastSuccessEmailDate !== localDate) {
  email = successEmail(latest!, { reportUrl: config.reportUrl, recoveredAfter: state.consecutiveFailures });
}

let exitCode = failure ? 1 : 0;
let sent = false;
if (email && print) {
  console.log(`\n--- Subject: ${email.subject} ---\n${email.text}\n---`);
} else if (email && !config.email) {
  console.log("Email not configured; skipping. Set NOTIFY_GMAIL_USER, NOTIFY_GMAIL_APP_PASSWORD and NOTIFY_EMAIL_TO in .env.");
} else if (email && config.email) {
  try {
    await sendEmail(config.email, email);
    sent = true;
    console.log(`Emailed ${config.email.to}: ${email.subject}`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    console.error(`Couldn't send email${code ? ` [${code}]` : ""}: ${err instanceof Error ? err.message : err}`);
    if (code === "EAUTH") console.error("Gmail rejected the login: check NOTIFY_GMAIL_USER and NOTIFY_GMAIL_APP_PASSWORD in .env.");
    exitCode ||= 2;
  }
} else {
  console.log("Success email already sent today; skipping.");
}

if (!print) {
  const next: NotifyState = failure
    ? { ...state, consecutiveFailures: state.consecutiveFailures + 1 }
    : { lastSuccessEmailDate: sent ? localDate : state.lastSuccessEmailDate, consecutiveFailures: 0 };
  await writeFile(statePath, JSON.stringify(next, null, 2)).catch((err) => console.error(`Couldn't save ${statePath}: ${err}`));
}

process.exitCode = exitCode;
