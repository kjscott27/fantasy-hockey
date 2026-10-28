import type { Config } from "../config.ts";

const BASE_URL = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fhl";

export interface EspnRequest {
  views?: string[];
  params?: Record<string, string | number>;
  /** Sent as the x-fantasy-filter header (used by kona_player_info). */
  filter?: unknown;
}

/**
 * Read-only ESPN fantasy hockey client.
 *
 * Every request is a hard-coded GET. There is deliberately no way to pass a method
 * or body, and no wrappers for transaction/lineup endpoints: this tool suggests
 * moves, it never makes them.
 */
export class EspnClient {
  constructor(private readonly config: Config) {}

  /** Season-wide data that needs no auth (pro teams, pro schedules). */
  season<T>(req: EspnRequest = {}): Promise<T> {
    return this.get(`seasons/${this.config.season}`, req);
  }

  /** The global player pool with ESPN's stats and projections (no auth). */
  playerPool<T>(req: EspnRequest = {}): Promise<T> {
    return this.get(`seasons/${this.config.season}/segments/0/leaguedefaults/1`, req);
  }

  /** Your private league (requires espn_s2 + SWID cookies). */
  league<T>(req: EspnRequest = {}): Promise<T> {
    if (!this.config.leagueId) throw new Error("ESPN_LEAGUE_ID is not set");
    return this.get(`seasons/${this.config.season}/segments/0/leagues/${this.config.leagueId}`, req);
  }

  private async get<T>(path: string, req: EspnRequest): Promise<T> {
    const url = new URL(`${BASE_URL}/${path}`);
    for (const view of req.views ?? []) url.searchParams.append("view", view);
    for (const [key, value] of Object.entries(req.params ?? {})) url.searchParams.set(key, String(value));

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.config.espnS2 && this.config.swid) {
      headers.Cookie = `espn_s2=${this.config.espnS2}; SWID=${this.config.swid}`;
    }
    if (req.filter !== undefined) headers["x-fantasy-filter"] = JSON.stringify(req.filter);

    const res = await fetch(url, { method: "GET", headers });
    if (res.status === 401 || res.status === 403) {
      throw new Error(`ESPN returned ${res.status} for ${url.pathname}. Check ESPN_S2/ESPN_SWID (cookies expire if you log out).`);
    }
    if (!res.ok) throw new Error(`ESPN returned ${res.status} for ${url}`);

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      throw new Error(`ESPN returned non-JSON (${contentType}) for ${url.pathname}; usually means the cookies are invalid.`);
    }
    return (await res.json()) as T;
  }
}
