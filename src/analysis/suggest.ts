import type { Player, RosterPlayer } from "../espn/league.ts";
import { planWeek, type DayPlan, type PlanPlayer, type SlotCounts } from "./lineup.ts";
import type { Valuation } from "./value.ts";

export interface PlanningContext {
  slots: SlotCounts;
  /** Max rostered (non-IR) players per position, e.g. { G: 3 }. */
  positionLimits: Record<string, number>;
  playsOn: (proTeamId: number, period: number) => boolean;
  /** Days of this matchup week not yet played (today included). */
  thisWeekDays: { period: number; date: string }[];
  nextWeekDays: { period: number; date: string }[];
  today: number;
}

export function toPlanPlayer(p: Player, v: Valuation, availableFrom?: number): PlanPlayer {
  return { id: p.id, eligible: p.eligible, proTeamId: p.proTeamId, perTeamGame: v.perTeamGame, availableFrom };
}

/** Rest-of-season value per team game, ignoring short-term injury. */
export function rosValue(v: Valuation): number {
  return v.ppg * v.startShare;
}

export interface RawSwap {
  dropId: number;
  addId: number;
  usableFrom: number;
  thisWeekGain: number;
  nextWeekGain: number;
  totalGain: number;
  rosDiff: number;
}

const DROP_CANDIDATES = 6;
const ADD_CANDIDATES = 40;
const MAX_SUGGESTIONS = 15;
const MAX_PER_ADD = 3;

/**
 * Ranks drop -> add swaps by projected fantasy points gained over the rest of this
 * week plus all of next week, using the real NHL schedule and the daily lineup
 * optimizer. Two weeks rather than one because adds are capped per matchup, so
 * one-game streams rarely beat a lasting upgrade.
 */
export function suggestSwaps(
  roster: RosterPlayer[],
  freeAgents: Player[],
  values: Map<number, Valuation>,
  ctx: PlanningContext,
  acquisitionsRemaining: number | null,
): RawSwap[] {
  const val = (p: Player) => values.get(p.id)!;
  const active = roster.filter((p) => p.lineupSlot !== "IR");
  const basePlayers = active.map((p) => toPlanPlayer(p, val(p)));

  const canAddThisWeek = acquisitionsRemaining === null || acquisitionsRemaining > 0;
  const nextWeekStart = ctx.nextWeekDays[0]?.period ?? ctx.today + 7;

  const thisWeek = (players: PlanPlayer[]) => planWeek(players, ctx.thisWeekDays, ctx.playsOn, ctx.slots).total;
  const nextWeek = (players: PlanPlayer[]) => planWeek(players, ctx.nextWeekDays, ctx.playsOn, ctx.slots).total;
  const baseThis = thisWeek(basePlayers);
  const baseNext = nextWeek(basePlayers);

  const drops = active
    .filter((p) => p.droppable)
    .sort((a, b) => rosValue(val(a)) - rosValue(val(b)))
    .slice(0, DROP_CANDIDATES);

  const adds = freeAgents
    .filter((p) => val(p).availability > 0 && p.eligible.some((s) => (ctx.slots[s] ?? 0) > 0))
    .sort((a, b) => rosValue(val(b)) - rosValue(val(a)))
    .slice(0, ADD_CANDIDATES);

  const swaps: RawSwap[] = [];
  for (const add of adds) {
    // A free agent added today usually can't play until tomorrow (roster locks at the
    // day's first game); a waiver claim clears after the waiver period.
    const delay = add.status === "WAIVERS" ? 2 : 1;
    const usableFrom = canAddThisWeek ? ctx.today + delay : Math.max(nextWeekStart, ctx.today + delay);

    for (const drop of drops) {
      const limit = ctx.positionLimits[add.position];
      const rostered = active.filter((p) => p.position === add.position && p.id !== drop.id).length;
      if (limit !== undefined && rostered + 1 > limit) continue;

      const players =[...basePlayers.filter((p) => p.id !== drop.id), toPlanPlayer(add, val(add), usableFrom)];
      const thisWeekGain = canAddThisWeek ? thisWeek(players) - baseThis : 0;
      const nextWeekGain = nextWeek(players) - baseNext;
      swaps.push({
        dropId: drop.id,
        addId: add.id,
        usableFrom,
        thisWeekGain,
        nextWeekGain,
        totalGain: thisWeekGain + nextWeekGain,
        rosDiff: rosValue(val(add)) - rosValue(val(drop)),
      });
    }
  }

  const perAdd = new Map<number, number>();
  return swaps
    .filter((s) => s.totalGain > 0.5)
    .sort((a, b) => b.totalGain - a.totalGain || b.rosDiff - a.rosDiff)
    .filter((s) => {
      const n = perAdd.get(s.addId) ?? 0;
      perAdd.set(s.addId, n + 1);
      return n < MAX_PER_ADD;
    })
    .slice(0, MAX_SUGGESTIONS);
}

export interface LineupChange {
  action: "start" | "bench";
  id: number;
  slot: string | null;
}

/** Differences between the current lineup and today's optimal lineup. */
export function todayChanges(roster: RosterPlayer[], today: DayPlan | undefined): LineupChange[] {
  if (!today) return [];
  const optimal = new Map(today.starters.map((s) => [s.id, s.slot]));
  const isActive = (p: RosterPlayer) => p.lineupSlot !== "BN" && p.lineupSlot !== "IR";

  const starts = roster
    .filter((p) => optimal.has(p.id) && !isActive(p))
    .map((p): LineupChange => ({ action: "start", id: p.id, slot: optimal.get(p.id)! }));
  if (starts.length === 0) return [];

  // Only bench players occupying a slot someone better needs.
  const neededSlots = new Map<string, number>();
  for (const s of starts) neededSlots.set(s.slot!, (neededSlots.get(s.slot!) ?? 0) + 1);
  const benches = roster
    .filter((p) => isActive(p) && !optimal.has(p.id) && (neededSlots.get(p.lineupSlot) ?? 0) > 0)
    .map((p): LineupChange => {
      neededSlots.set(p.lineupSlot, neededSlots.get(p.lineupSlot)! - 1);
      return { action: "bench", id: p.id, slot: p.lineupSlot };
    });

  return [...starts, ...benches];
}

export interface Alert {
  level: "warn" | "info";
  message: string;
}

export function rosterAlerts(roster: RosterPlayer[], values: Map<number, Valuation>, irSlots: number): Alert[] {
  const alerts: Alert[] = [];
  const onIr = roster.filter((p) => p.lineupSlot === "IR");

  for (const p of roster) {
    const v = values.get(p.id)!;
    const active = p.lineupSlot !== "BN" && p.lineupSlot !== "IR";
    if (active && v.availability === 0) {
      alerts.push({ level: "warn", message: `${p.name} is ${p.injuryStatus} but in your active lineup (${p.lineupSlot}).` });
    }
    if (p.lineupSlot === "IR" && v.availability > 0) {
      alerts.push({
        level: "warn",
        message: `${p.name} is ${p.injuryStatus} but still on IR. ESPN blocks adds while an ineligible player sits on IR.`,
      });
    }
    if (p.lineupSlot === "BN" && v.availability === 0 && onIr.length < irSlots) {
      alerts.push({ level: "info", message: `${p.name} is ${p.injuryStatus}: move to the open IR slot to free a bench spot.` });
    }
    if (p.injuryStatus === "DAY_TO_DAY") {
      alerts.push({ level: "info", message: `${p.name} is day-to-day (projection discounted 25%). Check news before lock.` });
    }
  }
  return alerts;
}
