import type { ReactNode } from "react";
import type { getTranslations } from "next-intl/server";
import type { scheduleEntries } from "@/db/schema";
import { dayLabel } from "@/lib/calendar";
import { viewOfEntry, type TemplateLite } from "@/lib/cell-view";
import type { DayLabels } from "@/lib/codes";
import { formatDateTime } from "@/lib/dates";
import type { SwapStatus } from "@/lib/swap-state";
import type { SwapRow } from "@/lib/swaps";

type T = Awaited<ReturnType<typeof getTranslations<never>>>;
type Entry = typeof scheduleEntries.$inferSelect | null;

const STATUS_STYLE: Record<SwapStatus, string> = {
  waiting_colleague: "bg-amber-100 text-amber-800",
  waiting_manager: "bg-blue-50 text-blue-700",
  approved: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
  rejected: "bg-red-100 text-red-800",
  cancelled: "",
  expired: "",
};

export function SwapStatusBadge({ status, t }: { status: SwapStatus; t: T }) {
  return <span className={`badge whitespace-nowrap ${STATUS_STYLE[status]}`}>{t(`swaps.status.${status}`)}</span>;
}

/** Small coloured chip + text for one day's plan. */
function Plan({ e, templates, labels, t }: { e: Entry; templates: TemplateLite[]; labels: DayLabels; t: T }) {
  if (!e || e.kind === "none") return <span className="text-gray-400">{t("swaps.nothingPlanned")}</span>;
  const v = viewOfEntry(e, templates, labels);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex h-6 min-w-8 items-center justify-center rounded px-1.5 text-xs font-semibold ${
          v.kind === "shift" ? "text-white" : v.kind === "absence" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-500"
        }`}
        style={v.kind === "shift" ? { background: v.color ?? "#64748b" } : undefined}
      >
        {v.label}
      </span>
      <span className="text-xs text-gray-600">{v.kind === "shift" ? v.title.split(": ").at(-1) : v.title}</span>
    </span>
  );
}

/** Who swaps what: per day, each person's plan before → after. `meId` turns that person into "You". */
export function SwapCard({
  s,
  templates,
  labels,
  t,
  locale,
  meId,
  actions,
}: {
  s: SwapRow;
  templates: TemplateLite[];
  labels: DayLabels;
  t: T;
  locale: string;
  meId?: string;
  actions?: ReactNode;
}) {
  const name = (p: { id: string; name: string }) => (p.id === meId ? t("swaps.you") : p.name);
  const nameOf = (id: string) => name(id === s.requester.id ? s.requester : s.colleague);
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">
            {name(s.requester)} ⇄ {name(s.colleague)}
          </div>
          <div className="text-xs text-gray-500">
            {s.department} · {t("swaps.askedAt", { when: formatDateTime(s.createdAt) })}
          </div>
        </div>
        <SwapStatusBadge status={s.status} t={t} />
      </div>
      <div className="space-y-2">
        {s.dates.map((d) => (
          <div key={d} className="rounded-lg border border-gray-200 p-2">
            <div className="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">{dayLabel(d, locale)}</div>
            <ul className="space-y-1 text-sm">
              {s.moves
                .filter((m) => m.date === d)
                .map((m) => (
                  <li key={m.employeeId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="w-full shrink-0 truncate font-medium sm:w-28">{nameOf(m.employeeId)}</span>
                    <Plan e={m.before} templates={templates} labels={labels} t={t} />
                    <span className="text-gray-400">→</span>
                    <Plan e={m.after} templates={templates} labels={labels} t={t} />
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      {s.note && <p className="text-sm text-gray-600">“{s.note}”</p>}
      {s.decidedBy && (
        <p className="text-xs text-gray-500">
          {t(`swaps.status.${s.status}`)} · {s.decidedBy}
          {s.decisionNote ? ` – ${s.decisionNote}` : ""}
        </p>
      )}
      {actions}
    </div>
  );
}

/** One line for a finished swap: days, who, outcome. */
export function SwapLine({ s, t, locale, meId }: { s: SwapRow; t: T; locale: string; meId?: string }) {
  const name = (p: { id: string; name: string }) => (p.id === meId ? t("swaps.you") : p.name);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
      <span className="w-28 shrink-0 font-medium">{s.dates.map((d) => dayLabel(d, locale)).join(", ")}</span>
      <span className="min-w-0 flex-1 truncate">
        {name(s.requester)} ⇄ {name(s.colleague)}
      </span>
      <SwapStatusBadge status={s.status} t={t} />
      {s.decidedBy && (
        <span className="w-full text-xs text-gray-500">
          {s.decidedBy}
          {s.decisionNote ? ` – ${s.decisionNote}` : ""}
        </span>
      )}
    </li>
  );
}
