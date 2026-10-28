import type { DepartmentMonth } from "@/lib/costs";
import type { CostPoint } from "@/components/cost-chart";

/** Cumulative euros per day for one or more departments; budget as a straight line. */
export function cumulativeCost(months: DepartmentMonth[], today: string): CostPoint[] {
  const days = months[0]?.days ?? [];
  const budget = months.reduce((s, m) => s + (m.budgetCents ?? 0), 0);
  let actual = 0;
  let projected = 0;
  return days.map((d, i) => {
    for (const m of months) {
      actual += m.days[i].actualCents;
      projected += m.days[i].actualCents + m.days[i].plannedCents;
    }
    return {
      day: d.date.slice(8),
      budget: budget ? Math.round((budget * (i + 1)) / days.length) / 100 : null,
      actual: d.date <= today ? actual / 100 : null,
      projected: projected / 100,
    };
  });
}
