"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { copyNeeds, saveNeeds } from "@/app/(app)/needs/actions";
import { addDays, weekdayShort } from "@/lib/calendar";
import { formatDate } from "@/lib/dates";
import { ALL_DAYS, neededMinutes, WEEKDAYS, WEEKEND, type NeedPlan, type NeedRow, type SeasonLite } from "@/lib/needs-rules";
import type { LocationLite, RoleLite } from "@/lib/org-types";
import { formatHours } from "@/lib/shifts";

type Scope = { weekdays: number; seasonId: string | null; onDate: string | null; note: string | null };
type Block = { from: string; to: string; counts: Record<string, number> };

const MONDAY = "2024-01-01";
const blank = (): Scope => ({ weekdays: ALL_DAYS, seasonId: null, onDate: null, note: null });

/** Rows of a plan → time blocks with a count per role (the grid). */
function toBlocks(rows: NeedRow[]): Block[] {
  const map = new Map<string, Block>();
  for (const r of rows) {
    const k = `${r.from}|${r.to}`;
    const b = map.get(k) ?? { from: r.from, to: r.to, counts: {} };
    b.counts[r.roleId] = (b.counts[r.roleId] ?? 0) + r.count;
    map.set(k, b);
  }
  return [...map.values()].sort((a, b) => a.from.localeCompare(b.from));
}

/** Midnight as an end time is 24:00 (the time picker says 00:00). */
const endOf = (t: string) => (t === "00:00" ? "24:00" : t);

export function NeedsEditor({
  location,
  otherLocations,
  roles,
  seasons,
  plans,
}: {
  location: LocationLite;
  otherLocations: LocationLite[];
  roles: RoleLite[];
  seasons: SeasonLite[];
  plans: NeedPlan[];
}) {
  const t = useTranslations("needs");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<string | "new">(plans[0]?.id ?? "new");
  const plan = plans.find((p) => p.id === selected);
  const [scope, setScope] = useState<Scope>(plan ? { weekdays: plan.weekdays, seasonId: plan.seasonId, onDate: plan.onDate, note: plan.note } : blank());
  const [blocks, setBlocks] = useState<Block[]>(plan ? toBlocks(plan.rows) : [{ from: "07:00", to: "15:00", counts: {} }]);
  const [copyTo, setCopyTo] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();

  const dayNames = Array.from({ length: 7 }, (_, i) => weekdayShort(addDays(MONDAY, i), locale));
  const daysLabel = (w: number) => (w === ALL_DAYS ? t("everyDay") : w === WEEKDAYS ? t("monFri") : w === WEEKEND ? t("satSun") : dayNames.filter((_, i) => w & (1 << i)).join(", "));
  const ruleLabel = (s: Scope) =>
    s.onDate ? `${formatDate(s.onDate)}${s.note ? ` · ${s.note}` : ""}` : `${s.seasonId ? (seasons.find((x) => x.id === s.seasonId)?.name ?? "?") : t("allYear")} · ${daysLabel(s.weekdays)}`;

  const open = (p: NeedPlan | null) => {
    setSelected(p ? p.id : "new");
    setScope(p ? { weekdays: p.weekdays, seasonId: p.seasonId, onDate: p.onDate, note: p.note } : blank());
    setBlocks(p ? toBlocks(p.rows) : [{ from: "07:00", to: "15:00", counts: {} }]);
    setMsg({});
  };
  const rows = (): NeedRow[] => blocks.flatMap((b) => roles.filter((r) => (b.counts[r.id] ?? 0) > 0).map((r) => ({ from: b.from, to: endOf(b.to), roleId: r.id, count: b.counts[r.id] })));
  const totals = neededMinutes(rows());
  const run = (fn: () => Promise<{ ok?: string; error?: string }>, done: string) =>
    start(async () => {
      const res = await fn();
      setMsg(res.error ? res : { ok: done });
      if (!res.error) router.refresh();
    });
  const replaces = plan ? { weekdays: plan.weekdays, seasonId: plan.seasonId, onDate: plan.onDate, note: plan.note } : undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-2">
        <div className="text-xs font-semibold tracking-wide text-gray-500 uppercase">{t("rules", { place: location.code })}</div>
        {plans.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => open(p)}
            className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${selected === p.id ? "border-blue-600 bg-blue-50 font-medium" : "border-gray-200 bg-surface"}`}
          >
            {ruleLabel(p)}
          </button>
        ))}
        {!plans.length && <p className="text-sm text-gray-500">{t("noRules")}</p>}
        <button type="button" onClick={() => open(null)} className={`btn w-full ${selected === "new" ? "btn-primary" : ""}`}>
          + {t("newRule")}
        </button>
      </aside>

      <section className="card space-y-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`btn btn-sm ${!scope.onDate ? "btn-primary" : ""}`} onClick={() => setScope({ ...scope, onDate: null })}>
            {t("regular")}
          </button>
          <button type="button" className={`btn btn-sm ${scope.onDate ? "btn-primary" : ""}`} onClick={() => setScope({ ...scope, onDate: scope.onDate ?? new Date().toISOString().slice(0, 10) })}>
            {t("oneDate")}
          </button>
        </div>

        {scope.onDate ? (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="n-date">{t("date")}</label>
              <input id="n-date" type="date" className="input" value={scope.onDate} onChange={(e) => setScope({ ...scope, onDate: e.target.value || null })} />
            </div>
            <div className="min-w-48 flex-1">
              <label className="label" htmlFor="n-note">{t("note")}</label>
              <input id="n-note" className="input" placeholder={t("notePlaceholder")} value={scope.note ?? ""} onChange={(e) => setScope({ ...scope, note: e.target.value || null })} />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("days")}>
              {dayNames.map((d, i) => {
                const on = !!(scope.weekdays & (1 << i));
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setScope({ ...scope, weekdays: scope.weekdays ^ (1 << i) || scope.weekdays })}
                    className={`min-h-10 min-w-11 rounded-lg border px-2 text-sm font-medium ${on ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-surface"}`}
                  >
                    {d}
                  </button>
                );
              })}
              <span className="mx-1 text-gray-300">|</span>
              {[
                [ALL_DAYS, t("everyDay")],
                [WEEKDAYS, t("monFri")],
                [WEEKEND, t("satSun")],
              ].map(([w, label]) => (
                <button key={label} type="button" className="btn btn-sm" onClick={() => setScope({ ...scope, weekdays: w as number })}>
                  {label}
                </button>
              ))}
            </div>
            <div>
              <label className="label" htmlFor="n-season">{t("season")}</label>
              <select id="n-season" className="input w-auto" value={scope.seasonId ?? ""} onChange={(e) => setScope({ ...scope, seasonId: e.target.value || null })}>
                <option value="">{t("allYear")}</option>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({formatDate(s.fromDate)} – {formatDate(s.toDate)})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-xs text-gray-500">
                <th className="px-1 py-1 text-left font-medium">{t("from")}</th>
                <th className="px-1 py-1 text-left font-medium">{t("to")}</th>
                {roles.map((r) => (
                  <th key={r.id} className="min-w-20 px-1 py-1 text-center font-medium">
                    {r.name}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {blocks.map((b, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-1 py-1">
                    <input type="time" step={900} className="input w-28" aria-label={t("from")} value={b.from} onChange={(e) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
                  </td>
                  <td className="px-1 py-1">
                    <input type="time" step={900} className="input w-28" aria-label={t("to")} value={b.to === "24:00" ? "00:00" : b.to} onChange={(e) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
                  </td>
                  {roles.map((r) => (
                    <td key={r.id} className="px-1 py-1 text-center">
                      <input
                        type="number"
                        min={0}
                        max={99}
                        inputMode="numeric"
                        className="input w-16 text-center"
                        aria-label={`${r.name} ${b.from}–${b.to}`}
                        value={b.counts[r.id] ?? ""}
                        onChange={(e) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, counts: { ...x.counts, [r.id]: Math.max(0, Math.min(99, Number(e.target.value) || 0)) } } : x)))}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1">
                    <button type="button" className="btn btn-sm" aria-label={t("removeBlock")} onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            const last = blocks.at(-1);
            const from = last ? endOf(last.to) : "07:00";
            const h = Math.min(23, Number(from.slice(0, 2)) + 4);
            setBlocks([...blocks, { from: from === "24:00" ? "00:00" : from, to: `${String(h).padStart(2, "0")}:${from.slice(3, 5)}`, counts: {} }]);
          }}
        >
          + {t("addBlock")}
        </button>

        {totals.size > 0 && (
          <p className="text-xs text-gray-600">
            {t("perDay")}: {roles.filter((r) => totals.get(r.id)).map((r) => `${r.name} ${formatHours(totals.get(r.id)!)} ${tc("hourUnit")}`).join(" · ")}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => saveNeeds({ locationId: location.id, scope, rows: rows(), replaces }), t("saved"))}>
            {pending ? "…" : tc("save")}
          </button>
          {plan && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={pending}
              onClick={() => {
                if (confirm(t("removeConfirm"))) run(() => saveNeeds({ locationId: location.id, scope: replaces, rows: [] }), t("removed"));
              }}
            >
              {t("removeRule")}
            </button>
          )}
          {msg.ok && <span className="text-sm text-green-700">{msg.ok}</span>}
          {msg.error && <span className="text-sm text-red-600">{msg.error}</span>}
        </div>

        {otherLocations.length > 0 && rows().length > 0 && (
          <div className="space-y-2 rounded-lg bg-gray-50 p-3 text-sm">
            <div className="font-medium">{t("copyTitle", { rule: ruleLabel(scope) })}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {otherLocations.map((l) => (
                <label key={l.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={copyTo.includes(l.id)} onChange={(e) => setCopyTo(e.target.checked ? [...copyTo, l.id] : copyTo.filter((x) => x !== l.id))} />
                  {l.code} {l.name}
                </label>
              ))}
            </div>
            <button type="button" className="btn btn-sm" disabled={!copyTo.length || pending} onClick={() => run(() => copyNeeds({ locationId: location.id, scope, rows: rows(), to: copyTo }), t("copied"))}>
              {t("copy")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
