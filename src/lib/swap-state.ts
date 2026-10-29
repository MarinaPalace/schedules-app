// Pure rules for shift swaps (shared by server code and tests).

export const SWAP_ACTIONS = ["accepted", "declined", "cancelled", "approved", "rejected"] as const;
export type SwapAction = (typeof SWAP_ACTIONS)[number];
const FINAL: readonly SwapAction[] = ["declined", "cancelled", "approved", "rejected"];

export type SwapStatus = "waiting_colleague" | "waiting_manager" | "expired" | "approved" | "declined" | "cancelled" | "rejected";

export function isOpen(s: SwapStatus): s is "waiting_colleague" | "waiting_manager" {
  return s === "waiting_colleague" || s === "waiting_manager";
}

/** Dates a swap touches, in order. */
export function swapDates(r: { date1: string; date2: string | null }): string[] {
  return r.date2 && r.date2 !== r.date1 ? [r.date1, r.date2].sort() : [r.date1];
}

/**
 * State from the request's events (oldest first): a final event wins; an open request whose
 * first day has passed is expired; otherwise it waits for the colleague, then for the manager.
 */
export function swapStatus(actions: string[], dates: string[], today: string): SwapStatus {
  const final = actions.find((a): a is SwapAction => FINAL.includes(a as SwapAction));
  if (final) return final as SwapStatus;
  if (dates.some((d) => d < today)) return "expired";
  return actions.includes("accepted") ? "waiting_manager" : "waiting_colleague";
}

export const cellKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

/**
 * What the swap writes: on each day both people take over the other's plan.
 * `snapshot` maps "employeeId|date" to the entry that was published when the request was made.
 */
export function swapMoves(r: { requesterId: string; colleagueId: string; date1: string; date2: string | null; snapshot: Record<string, string | null> }) {
  return swapDates(r).flatMap((date) => {
    const a = r.snapshot[cellKey(r.requesterId, date)] ?? null;
    const b = r.snapshot[cellKey(r.colleagueId, date)] ?? null;
    return [
      { employeeId: r.requesterId, date, fromEntryId: a, toEntryId: b },
      { employeeId: r.colleagueId, date, fromEntryId: b, toEntryId: a },
    ];
  });
}

type DayLike = { kind: string; segments: { start: string; end: string }[]; absenceCode: string | null; shiftTemplateId: string | null } | null | undefined;

/** Same plan for the day (an empty day equals "not planned"). */
export function samePlan(a: DayLike, b: DayLike): boolean {
  const ka = a?.kind ?? "none";
  const kb = b?.kind ?? "none";
  if (ka !== kb) return false;
  if (ka === "shift") return JSON.stringify(a!.segments) === JSON.stringify(b!.segments) && (a!.shiftTemplateId ?? null) === (b!.shiftTemplateId ?? null);
  if (ka === "absence") return a!.absenceCode === b!.absenceCode;
  return true;
}
