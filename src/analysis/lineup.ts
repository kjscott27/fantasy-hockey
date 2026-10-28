/** Active lineup slot counts, e.g. { C: 2, LW: 2, RW: 2, D: 4, G: 2 }. */
export type SlotCounts = Record<string, number>;

export interface LineupCandidate {
  id: number;
  eligible: string[];
  value: number;
}

export interface Lineup {
  total: number;
  /** playerId -> slot for starters. */
  slots: Map<number, string>;
}

/**
 * Best single-day lineup. Exhaustive search with a branch-and-bound cutoff: players are
 * tried in value order, and a branch is abandoned once even filling every open slot
 * with the next-best remaining players can't beat the best lineup found so far.
 * A day has at most ~15 players with games, so this is instant.
 */
export function optimizeLineup(candidates: LineupCandidate[], slotCounts: SlotCounts): Lineup {
  const players = candidates
    .filter((c) => c.value > 0 && c.eligible.some((s) => (slotCounts[s] ?? 0) > 0))
    .sort((a, b) => b.value - a.value);

  const open: SlotCounts = { ...slotCounts };
  const current: (string | null)[] = [];
  let best = { total: 0, assignment: [] as (string | null)[] };

  const search = (i: number, total: number, openCount: number) => {
    if (i === players.length || openCount === 0) {
      if (total > best.total) best = { total, assignment: [...current] };
      return;
    }
    let bound = total;
    for (let k = i; k < Math.min(players.length, i + openCount); k++) bound += players[k].value;
    if (bound <= best.total) return;

    const p = players[i];
    for (const slot of new Set(p.eligible)) {
      if ((open[slot] ?? 0) <= 0) continue;
      open[slot]--;
      current.push(slot);
      search(i + 1, total + p.value, openCount - 1);
      current.pop();
      open[slot]++;
    }
    current.push(null);
    search(i + 1, total, openCount);
    current.pop();
  };

  search(0, 0, Object.values(slotCounts).reduce((a, b) => a + b, 0));

  const slots = new Map<number, string>();
  best.assignment.forEach((slot, i) => {
    if (slot) slots.set(players[i].id, slot);
  });
  return { total: best.total, slots };
}

export interface PlanPlayer {
  id: number;
  eligible: string[];
  proTeamId: number;
  perTeamGame: number;
  /** First scoring period the player can be used (e.g. after a waiver claim clears). */
  availableFrom?: number;
  /** Current ESPN lineup slot, which a player keeps once their game has started. */
  currentSlot?: string;
}

/** True once a team's game in that scoring period has started (lineups lock per game). */
export type StartedFn = (proTeamId: number, period: number) => boolean;

const isActiveSlot = (slot: string | undefined) => slot !== undefined && slot !== "BN" && slot !== "IR";

export interface DayPlan {
  period: number;
  date: string;
  total: number;
  starters: { id: number; slot: string; value: number }[];
  /** Players with a game who don't make the optimal lineup: points left on the bench. */
  benchedWithGame: { id: number; value: number }[];
}

export interface WeekPlan {
  total: number;
  days: DayPlan[];
}

export function planWeek(
  players: PlanPlayer[],
  days: { period: number; date: string }[],
  playsOn: (proTeamId: number, period: number) => boolean,
  slotCounts: SlotCounts,
  started: StartedFn = () => false,
): WeekPlan {
  const plans = days.map(({ period, date }) => {
    // Players whose game has started are locked where they are and have no points left
    // to add (anything they scored is already in the live score). Locked starters keep
    // their slot, so only the remaining slots are open to everyone else.
    const open: SlotCounts = { ...slotCounts };
    for (const p of players) {
      if (started(p.proTeamId, period) && isActiveSlot(p.currentSlot) && open[p.currentSlot!] !== undefined) {
        open[p.currentSlot!] = Math.max(0, open[p.currentSlot!] - 1);
      }
    }
    const playing = players.filter(
      (p) => playsOn(p.proTeamId, period) && !started(p.proTeamId, period) && (p.availableFrom ?? 0) <= period,
    );
    const lineup = optimizeLineup(
      playing.map((p) => ({ id: p.id, eligible: p.eligible, value: p.perTeamGame })),
      open,
    );
    return {
      period,
      date,
      total: lineup.total,
      starters: playing
        .filter((p) => lineup.slots.has(p.id))
        .map((p) => ({ id: p.id, slot: lineup.slots.get(p.id)!, value: p.perTeamGame })),
      benchedWithGame: playing
        .filter((p) => !lineup.slots.has(p.id) && p.perTeamGame > 0)
        .map((p) => ({ id: p.id, value: p.perTeamGame })),
    };
  });
  return { total: plans.reduce((sum, d) => sum + d.total, 0), days: plans };
}
