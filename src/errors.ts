/**
 * Coded errors for scheduled runs. Each code maps to a plain-English explanation and
 * fix steps, which the failure email shows instead of a bare stack trace.
 */
import { hostname, userInfo } from "node:os";

export type ErrorCode =
  | "CONFIG_MISSING"
  | "ESPN_AUTH"
  | "ESPN_NOT_FOUND"
  | "ESPN_UNAVAILABLE"
  | "ESPN_FORMAT"
  | "NHL_API"
  | "TEAM_NOT_FOUND"
  | "NETWORK"
  | "TIMEOUT"
  | "DISK"
  | "UNKNOWN";

export class RunError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** Extra facts for the email's Details section (HTTP status, path, ...). Never secrets. */
    readonly details: Record<string, string | number> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "RunError";
  }
}

export interface FailureDescription {
  code: ErrorCode;
  title: string;
  why: string;
  fix: string[];
  details: Record<string, string | number>;
}

// Scheduled runs happen on the Pi, so these name the right machine in the fix steps.
const PI_SSH = `${userInfo().username}@${hostname()}`;
const ENV_PATH = "~/fantasy-hockey/.env on the Pi";
const RETRY = "Nothing to do if it's a one-off: the next hourly run tries again automatically.";

const DESCRIPTIONS: Record<ErrorCode, Omit<FailureDescription, "code" | "details">> = {
  CONFIG_MISSING: {
    title: "A required setting is missing from .env",
    why: "The snapshot couldn't start because a value it needs isn't set. See the message below for which one.",
    fix: [`Open ${ENV_PATH} and fill in the missing value (compare with .env.example).`, "Rerun: scripts/pi/run-snapshot.sh"],
  },
  ESPN_AUTH: {
    title: "ESPN cookies expired",
    why: "ESPN rejected the espn_s2/SWID cookies, or sent a login page instead of data. This happens when you log out of ESPN in the browser you copied them from, or after they age out (usually months).",
    fix: [
      "On your computer, log in at fantasy.espn.com.",
      "Open DevTools → Application → Cookies → https://fantasy.espn.com and copy espn_s2 and SWID (keep SWID's curly braces).",
      "Paste them into ESPN_S2 and ESPN_SWID in your local .env.",
      `Copy it to the Pi: scp .env ${PI_SSH}:~/fantasy-hockey/.env`,
      "Rerun on the Pi: scripts/pi/run-snapshot.sh",
    ],
  },
  ESPN_NOT_FOUND: {
    title: "ESPN couldn't find the league",
    why: "ESPN returned 404. The league ID or season in .env doesn't match a league ESPN knows about. A new season is the usual cause: ESPN names seasons by the year they end.",
    fix: [`Check ESPN_LEAGUE_ID and ESPN_SEASON in ${ENV_PATH} (2026–27 = 2027).`, "Rerun: scripts/pi/run-snapshot.sh"],
  },
  ESPN_UNAVAILABLE: {
    title: "ESPN is down or rate-limiting",
    why: "ESPN's fantasy API returned a server error or 'too many requests'. This is on ESPN's side.",
    fix: [RETRY, "If it keeps failing for several hours, check whether fantasy.espn.com itself is working."],
  },
  ESPN_FORMAT: {
    title: "ESPN's data didn't look as expected",
    why: "ESPN's API is unofficial and undocumented. The response was missing something the tool relies on, so ESPN has probably changed its format.",
    fix: ["If it repeats, the code needs updating for the new format. Run `npm run probe` to save the raw responses to data/raw/ for comparison."],
  },
  NHL_API: {
    title: "The NHL API is unavailable",
    why: "The NHL standings request failed. This is on the NHL's side.",
    fix: [RETRY],
  },
  TEAM_NOT_FOUND: {
    title: "Couldn't find your team in the league",
    why: "None of the league's teams matched ESPN_TEAM_ID or the owner in your SWID cookie.",
    fix: [`Set ESPN_TEAM_ID in ${ENV_PATH} to the teamId= value in your ESPN team page URL.`],
  },
  NETWORK: {
    title: "The Pi couldn't reach the internet",
    why: "The request never got a response: the address couldn't be looked up or the connection was refused or dropped. The Pi is probably offline.",
    fix: [
      RETRY,
      "If it repeats, check the Pi is powered and on wifi (is it visible in your router's device list?).",
      "On the Pi: ping -c 3 espn.com",
    ],
  },
  TIMEOUT: {
    title: "A request timed out",
    why: "ESPN or the NHL API took longer than 30 seconds to respond, so the run gave up rather than hang.",
    fix: [RETRY, "If it repeats, the Pi's wifi may be weak: check its signal in its new spot."],
  },
  DISK: {
    title: "Couldn't write the report to disk",
    why: "Saving data/ or reports/ failed. The SD card or SSD may be full, read-only (often a sign it's failing), or the folder permissions changed.",
    fix: ["On the Pi: df -h ~ (check free space)", "ls -ld ~/fantasy-hockey/data ~/fantasy-hockey/reports (should be owned by you)"],
  },
  UNKNOWN: {
    title: "Unexpected error",
    why: "Something failed that the tool doesn't have a specific explanation for. The message and stack trace below show where.",
    fix: ["Check the full output in ~/fantasy-hockey/logs/snapshot.log on the Pi.", "Run scripts/pi/run-snapshot.sh by hand to see if it repeats."],
  },
};

const NETWORK_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "UND_ERR_SOCKET"]);
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
const DISK_CODES = new Set(["ENOSPC", "EACCES", "EPERM", "EROFS", "EIO"]);

const errCode = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;

/** Best-effort code for errors not raised as RunError (Node network, fs and abort errors). */
function classify(err: unknown): ErrorCode {
  if (err instanceof RunError) return err.code;
  // AbortSignal.timeout() rejects fetch with a DOMException named TimeoutError.
  if ((err as { name?: unknown } | null)?.name === "TimeoutError") return "TIMEOUT";
  if (!(err instanceof Error)) return "UNKNOWN";

  const code = errCode(err);
  const causeCode = errCode(err.cause);
  if (code && DISK_CODES.has(code)) return "DISK";
  if ([code, causeCode].some((c) => c && TIMEOUT_CODES.has(c))) return "TIMEOUT";
  if ([code, causeCode].some((c) => c && NETWORK_CODES.has(c))) return "NETWORK";
  if (err.message === "fetch failed") return "NETWORK";
  if (err instanceof SyntaxError) return "ESPN_FORMAT"; // res.json() on a truncated/garbled body
  return "UNKNOWN";
}

export function describeFailure(err: unknown): FailureDescription {
  const code = classify(err);
  const details: Record<string, string | number> = {};
  if (err instanceof Error) {
    details.message = err.message;
    // Node's own error code (ENOTFOUND, ENOSPC...); a RunError's `code` is already shown.
    const causeCode = errCode(err.cause) ?? (err instanceof RunError ? undefined : errCode(err));
    if (causeCode) details.errorCode = causeCode;
    if (err instanceof RunError) Object.assign(details, err.details);
    if (code === "UNKNOWN" && err.stack) details.stack = err.stack.split("\n").slice(0, 8).join("\n");
  } else {
    details.message = String(err);
  }
  return { code, ...DESCRIPTIONS[code], details };
}
