import Link from "next/link";
import { isWeekend, weekdayShort } from "@/lib/calendar";
import { cellLabel, EMPTY_CELL, placesOf, type CellView, type CustomLegendRow } from "@/lib/cell-view";
import { formatHours } from "@/lib/shifts";
import { ScrollToToday } from "@/components/scroll-to-today";

export type MonthTableRow = { id: string; name: string; position: string | null; isMe: boolean; cells: Record<string, CellView> };

/**
 * Read-only schedule grid for employees (no money). From today on, tapping a colleague's day
 * starts a swap request for that day; tapping your own day starts one with that day chosen.
 */
export function MonthTable({
  dates,
  rows,
  today,
  locale,
  swapLabel,
  codes,
  placeCodes = {},
}: {
  dates: string[];
  rows: MonthTableRow[];
  today: string;
  locale: string;
  swapLabel: string;
  codes: Map<string, CustomLegendRow>;
  /** Location codes by id: shown under the shift so people see where they work. */
  placeCodes?: Record<string, string>;
}) {
  return (
    <ScrollToToday className="-mx-4 overflow-x-auto border-y border-gray-200 bg-surface sm:mx-0 sm:rounded-xl sm:border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-28 border-b border-gray-200 bg-surface px-2 py-2 text-left text-xs font-medium text-gray-500" />
            {dates.map((d) => (
              <th
                key={d}
                data-today={d === today || undefined}
                className={`min-w-9 border-b border-l border-gray-200 px-0.5 py-1.5 text-center text-[11px] font-medium ${
                  d === today ? "bg-blue-50 text-blue-700" : isWeekend(d) ? "bg-gray-50 text-gray-500" : "text-gray-500"
                }`}
              >
                {weekdayShort(d, locale).slice(0, 2)}
                <br />
                {d.slice(8, 10)}
              </th>
            ))}
            <th className="border-b border-l border-gray-200 px-2 text-right text-xs font-medium text-gray-500">h</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const minutes = dates.reduce((s, d) => s + (r.cells[d]?.paidMinutes ?? 0), 0);
            return (
              <tr key={r.id} className={r.isMe ? "bg-amber-50" : ""}>
                <td className={`sticky left-0 z-10 max-w-36 border-b border-gray-100 px-2 py-1 ${r.isMe ? "bg-amber-50" : "bg-surface"}`}>
                  <div className={`truncate text-xs ${r.isMe ? "font-bold" : "font-medium"}`}>{r.name}</div>
                  {r.position && <div className="truncate text-[11px] text-gray-500">{r.position}</div>}
                </td>
                {dates.map((d) => {
                  const c = r.cells[d] ?? EMPTY_CELL;
                  const where = [...new Set(placesOf(c).map((id) => (id ? placeCodes[id] : undefined)).filter(Boolean))].join("+");
                  const chip = <Chip c={c} label={cellLabel(c, codes)} tag={where} />;
                  const href = d >= today ? (r.isMe ? `/me/swap?date=${d}` : `/me/swap?date=${d}&with=${r.id}`) : null;
                  return (
                    <td key={d} title={c.title} className={`h-10 border-b border-l border-gray-100 p-0.5 text-center ${isWeekend(d) && !r.isMe ? "bg-gray-50" : ""}`}>
                      {href ? (
                        <Link href={href} aria-label={`${swapLabel}: ${r.name} ${d}`} className="block">
                          {chip}
                        </Link>
                      ) : (
                        chip
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-l border-gray-100 px-2 text-right text-xs tabular-nums">{formatHours(minutes)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollToToday>
  );
}

function Chip({ c, label, tag }: { c: CellView; label: string; tag?: string }) {
  return (
    <span
      className={`inline-flex h-8 w-full min-w-8 items-center justify-center rounded-md text-xs font-semibold ${
        c.kind === "shift" ? "text-white" : c.kind === "absence" ? "bg-amber-100 text-amber-800" : c.kind === "off" ? "bg-gray-100 text-gray-500" : ""
      }`}
      style={c.kind === "shift" ? { background: c.color ?? "#64748b" } : undefined}
    >
      {c.kind === "none" ? (
        ""
      ) : (
        <span className="flex flex-col items-center leading-none">
          <span>{label}</span>
          {tag && <span className="mt-0.5 text-[9px] font-medium opacity-90">{tag}</span>}
        </span>
      )}
    </span>
  );
}
