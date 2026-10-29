"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { requestSwap } from "@/app/(app)/swaps/actions";
import { EMPTY_CELL, type CellView } from "@/lib/cell-view";
import { dayLabel } from "@/lib/calendar";

type Person = { id: string; name: string; position: string | null; hasLogin: boolean };

const k = (employeeId: string, date: string) => `${employeeId}|${date}`;
const same = (a: CellView, b: CellView) => a.kind === b.kind && a.label === b.label && a.title === b.title;

/**
 * Asking a colleague to swap: pick your day, pick who, optionally a second day,
 * and see exactly what changes before sending.
 */
export function SwapForm(props: {
  meId: string;
  people: Person[];
  dates: string[];
  cells: Record<string, CellView>;
  locked: Record<string, true>;
  initialDate: string | null;
  initialWith: string | null;
}) {
  const { meId, people, dates, cells, locked } = props;
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [state, formAction, sending] = useActionState(requestSwap, {});
  const [date1, setDate1] = useState(props.initialDate ?? "");
  const [withId, setWithId] = useState(props.initialWith ?? "");
  const [second, setSecond] = useState(false);
  const [date2, setDate2] = useState("");

  useEffect(() => {
    if (state.ok) router.push("/me#swaps");
  }, [state, router]);

  const cell = (p: string, d: string) => cells[k(p, d)] ?? EMPTY_CELL;
  const colleague = people.find((p) => p.id === withId);
  const days = [date1, second ? date2 : ""].filter(Boolean);
  const changes = colleague ? days.filter((d) => !same(cell(meId, d), cell(colleague.id, d))) : [];
  const lockedDay = colleague && days.some((d) => locked[k(meId, d)] || locked[k(colleague.id, d)]);
  const absence = colleague && days.some((d) => cell(meId, d).kind === "absence" || cell(colleague.id, d).kind === "absence");
  const ready = !!colleague && colleague.hasLogin && date1 && (!second || date2) && changes.length > 0 && !lockedDay && !absence;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="date1" value={date1} />
      <input type="hidden" name="date2" value={second ? date2 : ""} />
      <input type="hidden" name="colleagueId" value={withId} />

      <section className="card space-y-2">
        <label className="label" htmlFor="swap-date1">
          1. {t("swaps.stepDay")}
        </label>
        <select id="swap-date1" className="input min-h-11" value={date1} onChange={(e) => setDate1(e.target.value)} required>
          <option value="" disabled>
            {t("common.choose")}
          </option>
          {dates.map((d) => (
            <option key={d} value={d} disabled={!!locked[k(meId, d)]}>
              {dayLabel(d, locale)} · {describe(cell(meId, d), t("swaps.nothingPlanned"))}
            </option>
          ))}
        </select>
      </section>

      <section className="card space-y-2">
        <div className="label">2. {t("swaps.stepWho")}</div>
        <ul className="divide-y divide-gray-100">
          {people.map((p) => {
            const c = date1 ? cell(p.id, date1) : null;
            const chosen = p.id === withId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={!p.hasLogin}
                  onClick={() => setWithId(p.id)}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-lg px-2 py-2 text-left disabled:opacity-50 ${chosen ? "bg-blue-50 ring-2 ring-blue-500" : ""}`}
                  aria-pressed={chosen}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-gray-500">{p.hasLogin ? p.position : t("swaps.noLogin")}</span>
                  </span>
                  {c && <Chip c={c} />}
                </button>
              </li>
            );
          })}
          {people.length === 0 && <li className="py-2 text-sm text-gray-500">{t("swaps.noColleagues")}</li>}
        </ul>
      </section>

      <section className="card space-y-2">
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input type="checkbox" className="h-5 w-5" checked={second} onChange={(e) => setSecond(e.target.checked)} />
          3. {t("swaps.stepSecond")}
        </label>
        {second && (
          <select className="input min-h-11" value={date2} onChange={(e) => setDate2(e.target.value)} aria-label={t("swaps.stepSecond")}>
            <option value="" disabled>
              {t("common.choose")}
            </option>
            {dates
              .filter((d) => d !== date1)
              .map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d, locale)} · {t("swaps.you")}: {describe(cell(meId, d), "–")}
                  {colleague ? ` · ${colleague.name.split(" ").at(-1)}: ${describe(cell(colleague.id, d), "–")}` : ""}
                </option>
              ))}
          </select>
        )}
        <p className="text-xs text-gray-500">{t("swaps.secondHelp")}</p>
      </section>

      {colleague && days.length > 0 && (
        <section className="card space-y-2 border-blue-200 bg-blue-50/40">
          <h2 className="text-sm font-medium">{t("swaps.preview")}</h2>
          {days.map((d) => (
            <div key={d} className="text-sm">
              <div className="text-xs font-semibold text-gray-500 uppercase">{dayLabel(d, locale)}</div>
              <PreviewLine who={t("swaps.you")} from={cell(meId, d)} to={cell(colleague.id, d)} />
              <PreviewLine who={colleague.name} from={cell(colleague.id, d)} to={cell(meId, d)} />
            </div>
          ))}
          {changes.length === 0 && <p className="text-sm text-amber-700">{t("errors.swapNothing")}</p>}
          {lockedDay && <p className="text-sm text-amber-700">{t("errors.swapDayApproved")}</p>}
          {absence && <p className="text-sm text-amber-700">{t("errors.swapAbsence")}</p>}
        </section>
      )}

      <section className="card space-y-3">
        <div>
          <label className="label" htmlFor="swap-note">
            {t("common.noteOptional")}
          </label>
          <input id="swap-note" name="note" className="input" maxLength={300} placeholder={t("swaps.notePlaceholder")} />
        </div>
        <button type="submit" className="btn btn-primary min-h-12 w-full" disabled={!ready || sending}>
          {sending ? "…" : colleague ? t("swaps.send", { name: colleague.name.split(" ").at(-1) ?? "" }) : t("swaps.sendPlain")}
        </button>
        <p className="text-xs text-gray-500">{t("swaps.afterSend")}</p>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      </section>
    </form>
  );
}

function describe(c: CellView, empty: string) {
  if (c.kind === "none") return empty;
  return c.kind === "shift" ? `${c.label} ${c.title.split(": ").at(-1)}` : c.title || c.label;
}

function Chip({ c }: { c: CellView }) {
  return (
    <span
      className={`inline-flex h-10 min-w-12 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-semibold ${
        c.kind === "shift" ? "text-white" : c.kind === "absence" ? "bg-amber-100 text-amber-800" : c.kind === "off" ? "bg-gray-100 text-gray-500" : "border border-dashed border-gray-300 text-gray-400"
      }`}
      style={c.kind === "shift" ? { background: c.color ?? "#64748b" } : undefined}
    >
      {c.kind === "none" ? "∅" : c.label}
    </span>
  );
}

function PreviewLine({ who, from, to }: { who: string; from: CellView; to: CellView }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-28 shrink-0 truncate">{who}</span>
      <Chip c={from} />
      <span className="text-gray-400">→</span>
      <Chip c={to} />
    </div>
  );
}
