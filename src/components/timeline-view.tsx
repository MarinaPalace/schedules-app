"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addDays, dayLabel } from "@/lib/calendar";
import { EMPTY_CELL, type CellView } from "@/lib/cell-view";
import { countBySlot, DAY, dayIntervals, minStaff, minutesLabel, presenceBetween, type Interval } from "@/lib/coverage";

const k = (employeeId: string, date: string) => `${employeeId}|${date}`;
const SLOT = 30;
const TIMES = Array.from({ length: DAY / SLOT + 1 }, (_, i) => i * SLOT);
const pct = (m: number) => `${(m / DAY) * 100}%`;

/** Blue, stronger the more people work (readable in light and dark mode). */
function heat(n: number, max: number) {
  if (!n) return undefined;
  const a = 0.15 + 0.75 * (n / Math.max(1, max));
  return { background: `rgba(37, 99, 235, ${a.toFixed(2)})`, color: a > 0.5 ? "white" : undefined };
}

/**
 * Who is at work when: a bar per person over the day, staff count per half hour,
 * a "from–to" check (whole time / part of it), and the week as a heat map.
 */
export function TimelineView({
  dates,
  employees,
  cells,
  day,
  onDay,
  strip,
  label,
  onOpen,
}: {
  dates: string[];
  employees: { id: string; name: string; position: string | null }[];
  cells: Record<string, CellView>;
  day: string;
  onDay: (d: string) => void;
  strip: ReactNode;
  label: (c: CellView) => string;
  onOpen?: (employeeId: string, date: string) => void;
}) {
  const t = useTranslations("timeline");
  const locale = useLocale();
  const [from, setFrom] = useState(7 * 60);
  const [to, setTo] = useState(12 * 60);

  const peopleOn = (d: string) =>
    employees.map((e) => ({ e, c: cells[k(e.id, d)] ?? EMPTY_CELL, iv: dayIntervals(cells[k(e.id, d)]?.segments, cells[k(e.id, addDays(d, -1))]?.segments) }));
  const people = peopleOn(day);
  const counts = countBySlot(people.map((p) => p.iv), SLOT);
  const max = Math.max(1, ...counts);
  const range = to > from ? ([from, to] as const) : null;
  const status = range ? people.map((p) => ({ ...p, presence: presenceBetween(p.iv, range[0], range[1]) })) : [];
  const full = status.filter((p) => p.presence === "full");
  const part = status.filter((p) => p.presence === "part");
  const least = range ? minStaff(people.map((p) => p.iv), range[0], range[1]) : 0;
  const week = dates.map((d) => ({ d, perHour: countBySlot(peopleOn(d).map((p) => p.iv), 60) }));
  const weekMax = Math.max(1, ...week.flatMap((w) => w.perHour));
  const hours = Array.from({ length: 24 }, (_, h) => h);

  const bar = (iv: Interval, c: CellView, i: number) => (
    <span
      key={i}
      className="absolute top-1 bottom-1 flex items-center overflow-hidden rounded px-1 text-[11px] font-semibold whitespace-nowrap text-white"
      style={{ left: pct(iv[0]), width: pct(iv[1] - iv[0]), background: c.color ?? "#64748b" }}
      title={c.title}
    >
      {label(c)}
    </span>
  );

  return (
    <div className="space-y-3">
      {strip}

      <div className="card space-y-2 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t("whoIsThere")}</span>
          <select className="input w-auto py-1" value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label={t("from")}>
            {TIMES.slice(0, -1).map((m) => (
              <option key={m} value={m}>
                {minutesLabel(m)}
              </option>
            ))}
          </select>
          <span>–</span>
          <select className="input w-auto py-1" value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label={t("to")}>
            {TIMES.slice(1).map((m) => (
              <option key={m} value={m}>
                {m === DAY ? "24:00" : minutesLabel(m)}
              </option>
            ))}
          </select>
        </div>
        {range ? (
          <div className="space-y-1 text-sm" aria-live="polite">
            <p>
              <b className="text-lg tabular-nums">{least}</b> {t("atLeast", { from: minutesLabel(from), to: to === DAY ? "24:00" : minutesLabel(to) })}
            </p>
            <p className="text-green-700">
              {t("full", { count: full.length })}
              {full.length > 0 && <span className="text-gray-600">: {full.map((p) => p.e.name).join(", ")}</span>}
            </p>
            {part.length > 0 && (
              <p className="text-amber-700">
                {t("part", { count: part.length })}: <span className="text-gray-600">{part.map((p) => `${p.e.name} (${label(p.c)})`).join(", ")}</span>
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-red-600">{t("badRange")}</p>
        )}
      </div>

      <div className="card overflow-x-auto p-0 sm:p-0">
        <div className="min-w-[760px]">
          {/* hour axis */}
          <div className="flex border-b border-gray-200 text-[11px] text-gray-500">
            <div className="sticky left-0 z-10 w-36 shrink-0 bg-surface px-3 py-1.5 font-medium">{dayLabel(day, locale)}</div>
            <div className="relative h-7 flex-1">
              {hours.map((h) => (
                <span key={h} className="absolute top-1.5 -translate-x-1/2" style={{ left: pct(h * 60) }}>
                  {h % 2 === 0 ? String(h).padStart(2, "0") : ""}
                </span>
              ))}
            </div>
          </div>
          {/* people */}
          <div className="relative">
            {people.map(({ e, c, iv }) => (
              <div key={e.id} className="flex border-b border-gray-100">
                <button
                  type="button"
                  disabled={!onOpen}
                  onClick={() => onOpen?.(e.id, day)}
                  className="sticky left-0 z-10 w-36 shrink-0 truncate bg-surface px-3 py-2 text-left text-sm font-medium disabled:cursor-default"
                >
                  {e.name}
                </button>
                <div className="relative h-10 flex-1">
                  {hours.map((h) => (
                    <span key={h} className={`absolute top-0 bottom-0 border-l ${h % 6 === 0 ? "border-gray-200" : "border-gray-100"}`} style={{ left: pct(h * 60) }} />
                  ))}
                  {range && <span className="absolute top-0 bottom-0 bg-blue-500/10" style={{ left: pct(range[0]), width: pct(range[1] - range[0]) }} />}
                  {iv.map((x, i) => bar(x, c, i))}
                  {!iv.length && c.kind !== "none" && <span className="absolute top-2.5 left-2 text-xs text-gray-400">{c.title || label(c)}</span>}
                </div>
              </div>
            ))}
          </div>
          {/* staff per half hour */}
          <div className="flex bg-gray-50">
            <div className="sticky left-0 z-10 w-36 shrink-0 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">{t("staff")}</div>
            <div className="flex flex-1">
              {counts.map((n, i) => (
                <span
                  key={i}
                  className="flex h-9 flex-1 items-center justify-center border-l border-white text-[11px] font-semibold tabular-nums dark:border-gray-900"
                  style={heat(n, max)}
                  title={`${minutesLabel(i * SLOT)}–${minutesLabel((i + 1) * SLOT)}: ${n}`}
                >
                  {n || ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {dates.length > 1 && (
        <div className="card overflow-x-auto p-0 sm:p-0">
          <div className="min-w-[760px]">
            <div className="flex border-b border-gray-200 text-[11px] text-gray-500">
              <div className="sticky left-0 z-10 w-36 shrink-0 bg-surface px-3 py-1.5 font-medium">{t("perHour")}</div>
              {hours.map((h) => (
                <span key={h} className="flex-1 py-1.5 text-center">
                  {String(h).padStart(2, "0")}
                </span>
              ))}
            </div>
            {week.map(({ d, perHour }) => (
              <button
                key={d}
                type="button"
                onClick={() => onDay(d)}
                className={`flex w-full border-b border-gray-100 text-left ${d === day ? "ring-2 ring-blue-500 ring-inset" : ""}`}
              >
                <span className="sticky left-0 z-10 w-36 shrink-0 bg-surface px-3 py-1.5 text-xs font-medium">{dayLabel(d, locale)}</span>
                {perHour.map((n, h) => (
                  <span key={h} className="flex h-7 flex-1 items-center justify-center text-[11px] tabular-nums" style={heat(n, weekMax)}>
                    {n || ""}
                  </span>
                ))}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-gray-500">{t("help")}</p>
    </div>
  );
}
