"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addDays, dayLabel } from "@/lib/calendar";
import { EMPTY_CELL, type CellView } from "@/lib/cell-view";
import { countBySlot, DAY, dayBlocks, minStaff, minutesLabel, pick, presenceBetween, type Block } from "@/lib/coverage";
import type { LocationLite, RoleLite } from "@/lib/org-types";
import { needSlots, type NeedRow } from "@/lib/needs-rules";

const k = (employeeId: string, date: string) => `${employeeId}|${date}`;
const SLOT = 30;
const TIMES = Array.from({ length: DAY / SLOT + 1 }, (_, i) => i * SLOT);
const pct = (m: number) => `${(m / DAY) * 100}%`;
const hhmm = (m: number) => (m === DAY ? "24:00" : minutesLabel(m));

/** Blue, stronger the more people work (readable in light and dark mode). */
function heat(n: number, max: number) {
  if (!n) return undefined;
  const a = 0.15 + 0.75 * (n / Math.max(1, max));
  return { background: `rgba(37, 99, 235, ${a.toFixed(2)})`, color: a > 0.5 ? "white" : undefined };
}

type Person = { id: string; name: string; position: string | null; roleId?: string | null };

/**
 * Who is at work when: a bar per person over the day, staff per half hour for every role
 * (at one location or all), staff per location, a "from–to" check per role, and the week as a heat map.
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
  places = [],
  roles = [],
  place = null,
  needs = {},
}: {
  dates: string[];
  employees: Person[];
  cells: Record<string, CellView>;
  day: string;
  onDay: (d: string) => void;
  strip: ReactNode;
  label: (c: CellView) => string;
  onOpen?: (employeeId: string, date: string) => void;
  places?: LocationLite[];
  roles?: RoleLite[];
  /** Location being planned (null = all). */
  place?: string | null;
  /** Staffing needs of the shown day, per location. */
  needs?: Record<string, NeedRow[]>;
}) {
  const t = useTranslations("timeline");
  const locale = useLocale();
  const [from, setFrom] = useState(7 * 60);
  const [to, setTo] = useState(12 * 60);
  // "" = every role; "none" = people without a role
  const [roleFilter, setRoleFilter] = useState("");
  const roleWhere = roleFilter === "" ? undefined : roleFilter === "none" ? null : roleFilter;

  /** Blocks of one person on a day; the role of a shift is the one planned (else the person's usual role). */
  const blocksOf = (e: Person, d: string): Block[] => {
    const day = cells[k(e.id, d)];
    const prev = cells[k(e.id, addDays(d, -1))];
    const withRole = (c?: CellView) => (c ? { segments: c.segments, roleId: c.roleId === undefined ? (e.roleId ?? null) : c.roleId } : undefined);
    return dayBlocks(withRole(day), withRole(prev));
  };
  const people = employees.map((e) => ({ e, c: cells[k(e.id, day)] ?? EMPTY_CELL, blocks: blocksOf(e, day) }));
  const here = (blocks: Block[], roleId?: string | null) => pick(blocks, { locationId: place, roleId });
  const shown = people.filter((p) => roleWhere === undefined || p.blocks.some((b) => b.roleId === roleWhere) || (!p.blocks.length && (p.e.roleId ?? null) === roleWhere));

  const range = to > from ? ([from, to] as const) : null;
  const status = range ? people.map((p) => ({ ...p, presence: presenceBetween(here(p.blocks, roleWhere), range[0], range[1]) })) : [];
  const full = status.filter((p) => p.presence === "full");
  const part = status.filter((p) => p.presence === "part");
  const least = range ? minStaff(people.map((p) => here(p.blocks, roleWhere)), range[0], range[1]) : 0;

  // Rows of the "staff per half hour" table: one per role (+ people without a role), then everybody.
  const roleRows = [
    ...roles.map((r) => ({ key: r.id, name: r.name, roleId: r.id as string | null })),
    ...(people.some((p) => p.blocks.some((b) => b.roleId === null)) || !roles.length ? [{ key: "none", name: roles.length ? t("noRole") : t("staff"), roleId: null }] : []),
  ].map((r) => ({ ...r, counts: countBySlot(people.map((p) => here(p.blocks, r.roleId)), SLOT) }));
  const totalCounts = countBySlot(people.map((p) => here(p.blocks, roleWhere)), SLOT);
  const placeRows = !place
    ? places.map((l) => ({ key: l.id, name: `${l.code} ${l.name}`, counts: countBySlot(people.map((p) => pick(p.blocks, { locationId: l.id, roleId: roleWhere })), SLOT) }))
    : [];
  // Needed per half hour for each role: at the selected location, or all locations together.
  const needByRole = new Map<string, number[]>();
  for (const [locId, rows] of Object.entries(needs)) {
    if (place && locId !== place) continue;
    for (const [roleId, arr] of needSlots(rows)) {
      const cur = needByRole.get(roleId) ?? new Array<number>(arr.length).fill(0);
      needByRole.set(roleId, cur.map((v, i) => v + arr[i]));
    }
  }
  const needTotal = [...needByRole.values()].reduce<number[] | undefined>((acc, arr) => (acc ? acc.map((v, i) => v + arr[i]) : [...arr]), undefined);
  const needInRange = (arr: number[] | undefined) => (arr && range ? Math.max(0, ...arr.slice(range[0] / SLOT, Math.ceil(range[1] / SLOT))) : 0);
  const max = Math.max(1, ...totalCounts, ...roleRows.flatMap((r) => r.counts), ...placeRows.flatMap((r) => r.counts));
  const week = dates.map((d) => ({ d, perHour: countBySlot(employees.map((e) => here(blocksOf(e, d), roleWhere)), 60) }));
  const weekMax = Math.max(1, ...week.flatMap((w) => w.perHour));
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const placeCode = (id: string | null) => places.find((l) => l.id === id)?.code;

  /** Have vs need: red = short, green = covered, amber = more than needed; plain heat when nothing is needed. */
  const needStyle = (n: number, need: number) =>
    need > 0 ? (n < need ? "bg-red-500 text-white" : n > need ? "bg-amber-300 text-amber-950" : "bg-green-600 text-white") : "";
  const slotRow = (key: string, name: string, counts: number[], strong = false, need?: number[]) => (
    <div key={key} className={`flex ${strong ? "bg-gray-50" : ""}`}>
      <div className={`sticky left-0 z-10 w-36 shrink-0 truncate px-3 py-1.5 text-xs ${strong ? "bg-gray-50 font-semibold" : "bg-surface font-medium text-gray-600"}`} title={name}>
        {name}
      </div>
      <div className="flex flex-1">
        {counts.map((n, i) => {
          // "have/need" is too wide for every half hour: label only where the value changes (it runs over the next cells)
          const label = need?.[i] ? (i === 0 || counts[i - 1] !== n || need[i - 1] !== need[i] ? `${n}/${need[i]}` : "") : null;
          return (
            <span
              key={i}
              className={`flex h-8 min-w-0 flex-1 items-center border-l border-white text-[11px] font-semibold whitespace-nowrap tabular-nums dark:border-gray-900 ${label ? "relative z-[1] justify-start pl-0.5" : "justify-center"} ${needStyle(n, need?.[i] ?? 0)}`}
              style={need?.[i] ? undefined : heat(n, max)}
              title={`${name} ${minutesLabel(i * SLOT)}–${hhmm((i + 1) * SLOT)}: ${n}${need?.[i] ? ` / ${need[i]}` : ""}`}
            >
              {label ?? (need?.[i] ? "" : n || "")}
            </span>
          );
        })}
      </div>
    </div>
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
                {hhmm(m)}
              </option>
            ))}
          </select>
          {roles.length > 0 && (
            <select className="input w-auto py-1" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label={t("roleFilter")}>
              <option value="">{t("allRoles")}</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
              <option value="none">{t("noRole")}</option>
            </select>
          )}
        </div>
        {range ? (
          <div className="space-y-1 text-sm" aria-live="polite">
            <p>
              <b className="text-lg tabular-nums">{least}</b> {t("atLeast", { from: minutesLabel(from), to: hhmm(to) })}
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
            {roles.length > 0 && roleFilter === "" && (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-gray-600">
                {roleRows.map((r) => {
                  const have = minStaff(people.map((p) => here(p.blocks, r.roleId)), range[0], range[1]);
                  const need = r.roleId ? needInRange(needByRole.get(r.roleId)) : 0;
                  return (
                    <li key={r.key} className={need && have < need ? "font-semibold text-red-700" : ""}>
                      <b className="tabular-nums">{have}</b> {r.name}
                      {need > 0 && ` (${t("needs", { count: need })})`}
                      {need > 0 && have < need && " ⚠"}
                    </li>
                  );
                })}
              </ul>
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
          {shown.map(({ e, c, blocks }) => (
            <div key={e.id} className="flex border-b border-gray-100">
              <button
                type="button"
                disabled={!onOpen}
                onClick={() => onOpen?.(e.id, day)}
                className="sticky left-0 z-10 w-36 shrink-0 truncate bg-surface px-3 py-1.5 text-left text-sm font-medium disabled:cursor-default"
                title={e.name}
              >
                {e.name}
                {roles.length > 0 && <span className="block truncate text-[11px] font-normal text-gray-500">{roles.find((r) => r.id === (blocks[0]?.roleId ?? e.roleId))?.name}</span>}
              </button>
              <div className="relative h-11 flex-1">
                {hours.map((h) => (
                  <span key={h} className={`absolute top-0 bottom-0 border-l ${h % 6 === 0 ? "border-gray-200" : "border-gray-100"}`} style={{ left: pct(h * 60) }} />
                ))}
                {range && <span className="absolute top-0 bottom-0 bg-blue-500/10" style={{ left: pct(range[0]), width: pct(range[1] - range[0]) }} />}
                {blocks.map((b, i) => {
                  const away = !!place && b.locationId !== place;
                  const code = placeCode(b.locationId);
                  return (
                    <span
                      key={i}
                      className={`absolute top-1.5 bottom-1.5 flex items-center gap-1 overflow-hidden rounded px-1 text-[11px] font-semibold whitespace-nowrap ${away ? "border border-dashed border-gray-400 text-gray-500" : "text-white"}`}
                      style={{ left: pct(b.start), width: pct(b.end - b.start), background: away ? undefined : (c.color ?? "#64748b") }}
                      title={`${c.title}${code ? ` · ${code}` : ""}`}
                    >
                      {label(c)}
                      {code && <span className="font-normal opacity-90">{code}</span>}
                    </span>
                  );
                })}
                {!blocks.length && c.kind !== "none" && <span className="absolute top-3 left-2 text-xs text-gray-400">{c.title || label(c)}</span>}
              </div>
            </div>
          ))}
          {/* staff per half hour – by role, then per location */}
          <div className="border-t border-gray-200">
            {roles.length > 0 && roleRows.map((r) => slotRow(r.key, r.name, r.counts, false, r.roleId ? needByRole.get(r.roleId) : undefined))}
            {slotRow(
              "total",
              roleFilter ? `${t("staff")} · ${roles.find((r) => r.id === roleFilter)?.name ?? t("noRole")}` : t("staff"),
              totalCounts,
              true,
              roleFilter ? (roleWhere ? needByRole.get(roleWhere) : undefined) : needTotal,
            )}
          </div>
          {placeRows.length > 0 && (
            <div className="border-t border-gray-200">
              <div className="px-3 pt-2 text-[11px] font-semibold tracking-wide text-gray-500 uppercase">{t("perPlace")}</div>
              {placeRows.map((r) => slotRow(r.key, r.name, r.counts))}
            </div>
          )}
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
      {needByRole.size > 0 && <p className="text-xs text-gray-500">{t("needsLegend")}</p>}
      <p className="text-xs text-gray-500">{t("help")}</p>
    </div>
  );
}
