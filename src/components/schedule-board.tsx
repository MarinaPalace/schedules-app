"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { copyPreviousWeek, publishSchedule, saveCells, type Tool } from "@/app/(app)/schedule/actions";
import { EMPTY_CELL, viewOfTool, type CellView, type TemplateLite, type ToolLite } from "@/lib/cell-view";
import { ABSENCE_CODES } from "@/lib/codes";
import { addDays, dayLabel, daysBetween, isWeekend, mondayOf, weekdayShort } from "@/lib/calendar";
import { costCents, rateAt, type RateBookJSON } from "@/lib/rates";
import { formatHours } from "@/lib/shifts";
import { formatEur } from "@/lib/money";
import { useDayLabels } from "@/lib/use-day-labels";
import { ShiftPicker } from "@/components/shift-picker";
import { setPreferenceCookie } from "@/lib/client-cookie";

export type BoardMode = "day" | "person" | "table";

type Props = {
  departmentId: string;
  dates: string[];
  employees: { id: string; name: string; position: string | null }[];
  initialCells: Record<string, CellView>;
  approved: Record<string, true>;
  /** Legends offered for this department. */
  templates: TemplateLite[];
  /** All legends, to display older entries. */
  allTemplates: TemplateLite[];
  rates: RateBookJSON;
  factor: number;
  editable: boolean;
  today: string;
  budget: { month: string; budgetCents: number | null; projectedCents: number } | null;
  weekStart: string | null;
  defaultMode: BoardMode;
  initialPerson?: string | null;
  /** False for employees viewing the department schedule: no money, no history links. */
  showCost?: boolean;
  /** Cells whose current plan employees cannot see yet. */
  unpublished?: Record<string, true>;
  /** Link to the PDF of the shown period. */
  pdfHref?: string;
};

type Change = { employeeId: string; date: string; prev: ToolLite };
const k = (employeeId: string, date: string) => `${employeeId}|${date}`;
const sameCell = (a: CellView, b: CellView) => a.kind === b.kind && a.label === b.label && a.paidMinutes === b.paidMinutes;

export function ScheduleBoard(props: Props) {
  const { departmentId, dates, employees, templates, allTemplates, rates, factor, editable, today, budget, weekStart, showCost = true } = props;
  const t = useTranslations();
  const locale = useLocale();
  const labels = useDayLabels();
  const router = useRouter();

  // Local copy of the plan; reset whenever the server sends fresh data.
  const [base, setBase] = useState(props.initialCells);
  const [cells, setCells] = useState(props.initialCells);
  const [unpub, setUnpub] = useState(props.unpublished ?? {});
  const [budgetDelta, setBudgetDelta] = useState(0);
  const [undoStack, setUndoStack] = useState<Change[][]>([]);
  if (base !== props.initialCells) {
    setBase(props.initialCells);
    setCells(props.initialCells);
    setUnpub(props.unpublished ?? {});
    setBudgetDelta(0);
    // Undo history stays valid across refreshes (it stores the values to restore).
  }
  const cellsRef = useRef(cells);
  useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  const [mode, setModeState] = useState<BoardMode>(props.defaultMode);
  const setMode = (m: BoardMode) => {
    setModeState(m);
    setPreferenceCookie("scheduleMode", m);
  };
  const [pickedDay, setPickedDay] = useState(today);
  const day = dates.includes(pickedDay) ? pickedDay : dates.includes(today) ? today : dates[0];
  const [pickedPerson, setPickedPerson] = useState(props.initialPerson ?? null);
  const person = employees.some((e) => e.id === pickedPerson) ? pickedPerson! : (employees[0]?.id ?? null);
  const [sheet, setSheet] = useState<{ employeeId: string; date: string } | null>(null);

  const [tool, setTool] = useState<Tool | null>(null);
  const [customText, setCustomText] = useState("08:00-16:00");
  const [status, setStatus] = useState<{ saving: number; error: string | null }>({ saving: 0, error: null });
  const [copying, startCopy] = useTransition();
  const [publishing, startPublish] = useTransition();
  const painting = useRef(false);
  const dragBatch = useRef<Change[]>([]);
  const queue = useRef(new Map<string, { employeeId: string; date: string; tool: ToolLite }>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cost = (employeeId: string, date: string, minutes: number) => costCents(minutes, rateAt(rates, employeeId, date), factor);

  function flush() {
    const batch = [...queue.current.values()];
    queue.current.clear();
    if (!batch.length) return;
    setStatus((s) => ({ saving: s.saving + 1, error: null }));
    saveCells(departmentId, batch).then((res) => {
      setStatus((s) => ({ saving: s.saving - 1, error: res.error ?? s.error }));
      // On error reload the truth from the server.
      if (res.error) router.refresh();
    });
  }

  /** Applies values locally, queues them for saving and returns what is needed to undo them. */
  function applyMany(changes: { employeeId: string; date: string; tool: ToolLite }[]): Change[] {
    if (!editable) return [];
    const next = { ...cellsRef.current };
    const undo: Change[] = [];
    const touched: string[] = [];
    let delta = 0;
    for (const ch of changes) {
      const view = viewOfTool(ch.tool, allTemplates, labels);
      if (!view) {
        setStatus((s) => ({ ...s, error: t("schedule.customFormat") }));
        continue;
      }
      const key = k(ch.employeeId, ch.date);
      const old = next[key] ?? EMPTY_CELL;
      if (sameCell(old, view)) continue;
      next[key] = view;
      touched.push(key);
      if (budget && ch.date.startsWith(budget.month) && !props.approved[key]) {
        delta += cost(ch.employeeId, ch.date, view.paidMinutes) - cost(ch.employeeId, ch.date, old.paidMinutes);
      }
      undo.push({ employeeId: ch.employeeId, date: ch.date, prev: old.tool });
      queue.current.set(key, ch);
    }
    if (!undo.length) return undo;
    cellsRef.current = next;
    setCells(next);
    setUnpub((u) => ({ ...u, ...Object.fromEntries(touched.map((key) => [key, true as const])) }));
    setBudgetDelta((d) => d + delta);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 350);
    return undo;
  }

  const record = (batch: Change[]) => {
    if (batch.length) setUndoStack((s) => [...s.slice(-49), batch]);
  };

  function undo() {
    const last = undoStack.at(-1);
    if (!last) return;
    setUndoStack((s) => s.slice(0, -1));
    applyMany([...last].reverse().map((c) => ({ employeeId: c.employeeId, date: c.date, tool: c.prev })));
  }

  // ---- table paint
  useEffect(() => {
    const stop = () => {
      if (painting.current) record(dragBatch.current);
      painting.current = false;
      dragBatch.current = [];
    };
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  });

  function paint(employeeId: string, date: string) {
    if (!tool) return;
    const effective: ToolLite = tool.type === "custom" ? { type: "custom", text: customText } : tool;
    dragBatch.current.push(...applyMany([{ employeeId, date, tool: effective }]));
  }

  // ---- picker navigation
  const order = (s: { employeeId: string; date: string }, step: 1 | -1) => {
    if (mode === "day") {
      const i = employees.findIndex((e) => e.id === s.employeeId) + step;
      return employees[i] ? { employeeId: employees[i].id, date: s.date } : null;
    }
    const i = dates.indexOf(s.date) + step;
    return dates[i] ? { employeeId: s.employeeId, date: dates[i] } : null;
  };
  function pick(toolPicked: ToolLite) {
    if (!sheet) return;
    record(applyMany([{ ...sheet, tool: toolPicked }]));
    setSheet(order(sheet, 1));
  }

  /** Person mode: copies one week of this person onto every later week shown. */
  function repeatWeek(employeeId: string, monday: string) {
    const changes = dates
      .filter((d) => mondayOf(d) > monday)
      .map((d) => ({ d, src: addDays(monday, ((daysBetween(monday, d) % 7) + 7) % 7) }))
      // A partial first week (month starting mid-week) only repeats the days that are shown.
      .filter(({ src }) => dates.includes(src))
      .map(({ d, src }) => ({ employeeId, date: d, tool: (cellsRef.current[k(employeeId, src)] ?? EMPTY_CELL).tool }));
    record(applyMany(changes));
  }

  // ---- totals
  const totals = (employeeId: string) =>
    dates.reduce(
      (acc, d) => {
        const c = cells[k(employeeId, d)];
        if (c?.paidMinutes) {
          acc.minutes += c.paidMinutes;
          acc.cents += cost(employeeId, d, c.paidMinutes);
        }
        return acc;
      },
      { minutes: 0, cents: 0 },
    );
  const unpublishedCount = Object.keys(unpub).filter((key) => dates.includes(key.split("|")[1])).length;
  const projected = budget ? budget.projectedCents + budgetDelta : 0;
  const over = budget?.budgetCents ? projected > budget.budgetCents : false;
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? "";
  const dayText = (d: string) => `${weekdayShort(d, locale)} ${d.slice(8, 10)}.${d.slice(5, 7)}`;

  return (
    <div className="space-y-3">
      {budget && showCost && (
        <div className={`card flex flex-wrap items-center gap-x-5 gap-y-1 py-2.5 text-sm ${over ? "border-red-200 bg-red-50" : ""}`}>
          <span>
            <span className="text-gray-500">{t("schedule.monthProjected")} </span>
            <b className="tabular-nums">{formatEur(projected)}</b>
          </span>
          <span>
            <span className="text-gray-500">{t("common.budget")}: </span>
            <b className="tabular-nums">{budget.budgetCents ? formatEur(budget.budgetCents) : t("common.notSet")}</b>
          </span>
          {budget.budgetCents ? (
            <span className={over ? "font-medium text-red-700" : "text-green-700"}>
              {over ? `▲ ${t("schedule.overBy")} ` : `✓ ${t("schedule.left")} `}
              {formatEur(Math.abs(budget.budgetCents - projected))}
            </span>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="grid w-full grid-cols-3 overflow-hidden rounded-xl border border-gray-300 bg-surface text-sm font-medium sm:inline-flex sm:w-auto" role="tablist">
          {(["day", "person", "table"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-11 px-4 ${mode === m ? "bg-blue-600 text-white" : "text-gray-700"}`}
            >
              {t(`schedule.mode.${m}`)}
            </button>
          ))}
        </div>
        {editable && weekStart && (
          <button
            type="button"
            className="btn"
            disabled={copying}
            onClick={() => {
              if (!confirm(t("schedule.copyConfirm"))) return;
              startCopy(async () => {
                const res = await copyPreviousWeek(departmentId, weekStart, employees.map((e) => e.id));
                setStatus((s) => ({ ...s, error: res.error ?? null }));
                router.refresh();
              });
            }}
          >
            ⧉ {copying ? t("schedule.copying") : t("schedule.copyWeek")}
          </button>
        )}
        {props.pdfHref && (
          <a href={props.pdfHref} target="_blank" rel="noopener" className="btn" title={t("schedule.pdfHint")}>
            ⬇ PDF
          </a>
        )}
      </div>

      {employees.length === 0 && <p className="card text-center text-sm text-gray-500">{t("schedule.noEmployees")}</p>}

      {/* ---------------- DAY ---------------- */}
      {mode === "day" && employees.length > 0 && (
        <div className="space-y-3">
          <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {dates.map((d) => {
              const working = employees.filter((e) => cells[k(e.id, d)]?.kind === "shift").length;
              const active = d === day;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setPickedDay(d)}
                  className={`flex min-w-14 shrink-0 snap-start flex-col items-center rounded-xl border px-2 py-2 ${
                    active ? "border-blue-600 bg-blue-600 text-white" : d === today ? "border-blue-300 bg-blue-50" : isWeekend(d) ? "border-gray-200 bg-gray-50" : "border-gray-200 bg-surface"
                  }`}
                >
                  <span className="text-xs uppercase opacity-80">{weekdayShort(d, locale)}</span>
                  <span className="text-lg leading-tight font-bold">{d.slice(8, 10)}</span>
                  <span className={`text-[11px] ${active ? "opacity-90" : "text-gray-500"}`}>👤 {working}</span>
                </button>
              );
            })}
          </div>

          <Coverage cells={cells} employees={employees} date={day} />

          <ul className="card divide-y divide-gray-100 p-0 sm:p-0">
            {employees.map((e) => {
              const c = cells[k(e.id, day)] ?? EMPTY_CELL;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    disabled={!editable}
                    onClick={() => setSheet({ employeeId: e.id, date: day })}
                    className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left active:bg-gray-50 disabled:cursor-default"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{e.name}</span>
                      <span className="block truncate text-xs text-gray-500">{c.kind !== "none" ? c.title : e.position}</span>
                    </span>
                    {unpub[k(e.id, day)] && editable && <span className="h-2 w-2 rounded-full bg-amber-500" title={t("schedule.notPublished")} />}
                    {props.approved[k(e.id, day)] && <span className="text-xs text-green-600">✓</span>}
                    <Chip c={c} big />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ---------------- PERSON ---------------- */}
      {mode === "person" && person && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn"
              aria-label={t("common.previous")}
              disabled={employees[0]?.id === person}
              onClick={() => setPickedPerson(employees[employees.findIndex((e) => e.id === person) - 1]?.id ?? person)}
            >
              ←
            </button>
            <select className="input min-h-11 flex-1 font-medium" value={person} onChange={(e) => setPickedPerson(e.target.value)}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              aria-label={t("common.next")}
              disabled={employees.at(-1)?.id === person}
              onClick={() => setPickedPerson(employees[employees.findIndex((e) => e.id === person) + 1]?.id ?? person)}
            >
              →
            </button>
          </div>
          <div className="text-sm text-gray-600">
            {(() => {
              const tt = totals(person);
              return `${formatHours(tt.minutes)} ${labels.hourUnit}${showCost ? ` · ${formatEur(tt.cents)}` : ""}`;
            })()}
          </div>
          {[...new Set(dates.map((d) => mondayOf(d)))].map((monday) => {
            const week = dates.filter((d) => mondayOf(d) === monday);
            const hasLater = dates.some((d) => mondayOf(d) > monday);
            return (
              <div key={monday} className="card p-0 sm:p-0">
                <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2">
                  <span className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    {dayText(week[0])} – {dayText(week[week.length - 1])}
                  </span>
                  {editable && hasLater && (
                    <button type="button" className="btn btn-sm" onClick={() => repeatWeek(person, monday)}>
                      ↻ {t("schedule.repeatWeek")}
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-gray-100">
                  {week.map((d) => {
                    const c = cells[k(person, d)] ?? EMPTY_CELL;
                    return (
                      <li key={d}>
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => setSheet({ employeeId: person, date: d })}
                          className={`flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-gray-50 disabled:cursor-default ${d === today ? "bg-blue-50" : ""}`}
                        >
                          <span className={`w-20 shrink-0 ${isWeekend(d) ? "text-gray-500" : ""}`}>
                            <span className="block text-xs uppercase">{weekdayShort(d, locale)}</span>
                            <span className="block font-semibold">
                              {d.slice(8, 10)}.{d.slice(5, 7)}
                            </span>
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-gray-600">{c.title}</span>
                          {unpub[k(person, d)] && editable && <span className="h-2 w-2 rounded-full bg-amber-500" title={t("schedule.notPublished")} />}
                          {props.approved[k(person, d)] && <span className="text-xs text-green-600">✓</span>}
                          <Chip c={c} big />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------------- TABLE ---------------- */}
      {mode === "table" && employees.length > 0 && (
        <div className="space-y-3">
          {editable && (
            <div className="card space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-gray-500">{t("schedule.paint")}</span>
                {templates.map((tpl) => (
                  <ToolButton
                    key={tpl.id}
                    active={tool?.type === "template" && tool.templateId === tpl.id}
                    onClick={() => setTool(tool?.type === "template" && tool.templateId === tpl.id ? null : { type: "template", templateId: tpl.id })}
                    style={{ background: tpl.color, color: "white", borderColor: tpl.color }}
                  >
                    {tpl.code}
                  </ToolButton>
                ))}
                <ToolButton active={tool?.type === "off"} onClick={() => setTool(tool?.type === "off" ? null : { type: "off" })}>
                  {t("schedule.off")}
                </ToolButton>
                {ABSENCE_CODES.map((code) => (
                  <ToolButton
                    key={code}
                    active={tool?.type === "absence" && tool.code === code}
                    onClick={() => setTool(tool?.type === "absence" && tool.code === code ? null : { type: "absence", code })}
                  >
                    <span title={labels.absence[code]}>{code}</span>
                  </ToolButton>
                ))}
                <ToolButton active={tool?.type === "custom"} onClick={() => setTool(tool?.type === "custom" ? null : { type: "custom", text: "" })}>
                  {t("schedule.custom")}
                </ToolButton>
                {tool?.type === "custom" && (
                  <input value={customText} onChange={(e) => setCustomText(e.target.value)} className="input w-48 py-1 font-mono text-xs" />
                )}
                <ToolButton active={tool?.type === "none"} onClick={() => setTool(tool?.type === "none" ? null : { type: "none" })}>
                  {t("schedule.clear")}
                </ToolButton>
              </div>
              <p className="text-xs text-gray-500">{tool ? t("schedule.hintTool") : t("schedule.hintNoTool")}</p>
            </div>
          )}
          <div className="card overflow-x-auto p-0 sm:p-0">
            <table className="w-full border-collapse text-sm select-none">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-36 border-b border-gray-200 bg-surface px-3 py-2 text-left text-xs font-medium text-gray-500">
                    {t("common.employee")}
                  </th>
                  {dates.map((d) => (
                    <th
                      key={d}
                      className={`min-w-11 border-b border-l border-gray-200 px-1 py-2 text-center text-[11px] font-medium ${
                        d === today ? "bg-blue-50 text-blue-700" : isWeekend(d) ? "bg-gray-50 text-gray-500" : "text-gray-500"
                      }`}
                    >
                      {dayLabel(d, locale).split(" ")[0]}
                      <br />
                      {d.slice(8, 10)}
                    </th>
                  ))}
                  <th className="border-b border-l border-gray-200 px-2 py-2 text-right text-xs font-medium text-gray-500">{t("common.hours")}</th>
                  {showCost && <th className="border-b border-l border-gray-200 px-2 py-2 text-right text-xs font-medium text-gray-500">{t("common.cost")}</th>}
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const tt = totals(e.id);
                  return (
                    <tr key={e.id}>
                      <td className="sticky left-0 z-10 border-b border-gray-100 bg-surface px-3 py-1.5">
                        <div className="font-medium whitespace-nowrap">{e.name}</div>
                        {e.position && <div className="text-xs text-gray-500">{e.position}</div>}
                      </td>
                      {dates.map((d) => {
                        const key = k(e.id, d);
                        const c = cells[key] ?? EMPTY_CELL;
                        return (
                          <td
                            key={d}
                            title={c.title + (props.approved[key] ? ` · ${t("schedule.approvedMark")}` : "")}
                            className={`relative h-11 border-b border-l border-gray-100 p-0.5 text-center ${isWeekend(d) ? "bg-gray-50" : ""} ${editable ? "cursor-pointer" : ""}`}
                            onPointerDown={(ev) => {
                              if (!editable) return;
                              if (!tool) {
                                setSheet({ employeeId: e.id, date: d });
                                return;
                              }
                              ev.preventDefault();
                              painting.current = true;
                              dragBatch.current = [];
                              paint(e.id, d);
                            }}
                            onPointerEnter={() => painting.current && paint(e.id, d)}
                          >
                            <Chip c={c} />
                            {props.approved[key] && <span className="absolute top-0 right-0.5 text-[9px] text-green-600">✓</span>}
                            {editable && unpub[key] && <span className="absolute top-0.5 left-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />}
                          </td>
                        );
                      })}
                      <td className="border-b border-l border-gray-100 px-2 text-right tabular-nums">{formatHours(tt.minutes)}</td>
                      {showCost && <td className="border-b border-l border-gray-100 px-2 text-right whitespace-nowrap tabular-nums">{formatEur(tt.cents)}</td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 text-xs text-gray-600">
                  <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 font-medium">{t("common.totalHours")}</td>
                  {dates.map((d) => {
                    const m = employees.reduce((sum, e) => sum + (cells[k(e.id, d)]?.paidMinutes ?? 0), 0);
                    return (
                      <td key={d} className="border-l border-gray-100 text-center tabular-nums">
                        {m ? formatHours(m) : ""}
                      </td>
                    );
                  })}
                  <td className="border-l border-gray-100 px-2 text-right font-semibold tabular-nums">
                    {formatHours(employees.reduce((s, e) => s + totals(e.id).minutes, 0))}
                  </td>
                  {showCost && (
                    <td className="border-l border-gray-100 px-2 text-right font-semibold whitespace-nowrap tabular-nums">
                      {formatEur(employees.reduce((s, e) => s + totals(e.id).cents, 0))}
                    </td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
          {showCost && <p className="text-xs text-gray-500">{t("schedule.footnote", { factor })}</p>}
        </div>
      )}

      {/* ---------------- ACTION BAR ---------------- */}
      {editable && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 md:bottom-3">
          <div className="card flex items-center gap-2 py-2 shadow-lg">
            <button type="button" className="btn min-h-12" disabled={!undoStack.length} onClick={undo}>
              ↶ {t("schedule.undo")}
            </button>
            <span
              className="min-w-0 flex-1 text-center text-xs text-gray-500"
              title={status.saving > 0 ? t("schedule.saving") : (status.error ?? t("schedule.allSaved"))}
              aria-live="polite"
            >
              {status.saving > 0 ? (
                <>
                  <span className="text-base sm:hidden">⏳</span>
                  <span className="hidden truncate sm:inline">{t("schedule.saving")}</span>
                </>
              ) : status.error ? (
                <span className="line-clamp-2 text-red-600">{status.error}</span>
              ) : (
                <>
                  <span className="text-base text-green-600 sm:hidden">✓</span>
                  <span className="hidden truncate sm:inline">{t("schedule.allSaved")}</span>
                </>
              )}
            </span>
            <button
              type="button"
              className={`btn min-h-12 ${unpublishedCount ? "btn-primary" : ""}`}
              disabled={publishing || status.saving > 0 || unpublishedCount === 0}
              onClick={() =>
                startPublish(async () => {
                  const res = await publishSchedule(departmentId, dates[0], dates[dates.length - 1]);
                  setStatus((s) => ({ ...s, error: res.error ?? null }));
                  router.refresh();
                })
              }
            >
              {publishing ? t("schedule.publishing") : unpublishedCount ? t("schedule.publish", { count: unpublishedCount }) : t("schedule.published")}
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <ShiftPicker
          key={`${sheet.employeeId}|${sheet.date}`}
          title={nameOf(sheet.employeeId)}
          subtitle={dayLabel(sheet.date, locale)}
          current={cells[k(sheet.employeeId, sheet.date)] ?? EMPTY_CELL}
          templates={templates}
          labels={labels}
          historyHref={showCost ? `/schedule/history?employee=${sheet.employeeId}&date=${sheet.date}` : undefined}
          onPick={pick}
          onPrev={order(sheet, -1) ? () => setSheet(order(sheet, -1)) : undefined}
          onNext={order(sheet, 1) ? () => setSheet(order(sheet, 1)) : undefined}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function Chip({ c, big }: { c: CellView; big?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg font-semibold ${big ? "h-12 min-w-14 px-2 text-base" : "h-7 w-full min-w-10 text-xs"} ${
        c.kind === "shift"
          ? "text-white"
          : c.kind === "absence"
            ? "bg-amber-100 text-amber-800"
            : c.kind === "off"
              ? "bg-gray-100 text-gray-500"
              : "border border-dashed border-gray-300 text-gray-400"
      }`}
      style={c.kind === "shift" ? { background: c.color ?? "#64748b" } : undefined}
    >
      {c.kind === "none" ? (big ? "+" : "") : c.label}
    </span>
  );
}

/** How many people work each legend on the day, plus off/absent. */
function Coverage({ cells, employees, date }: { cells: Record<string, CellView>; employees: { id: string }[]; date: string }) {
  const t = useTranslations();
  const groups = new Map<string, { label: string; color: string | null; n: number }>();
  let off = 0;
  let absent = 0;
  let empty = 0;
  for (const e of employees) {
    const c = cells[k(e.id, date)] ?? EMPTY_CELL;
    if (c.kind === "shift") {
      const g = groups.get(c.label) ?? { label: c.label, color: c.color, n: 0 };
      g.n++;
      groups.set(c.label, g);
    } else if (c.kind === "off") off++;
    else if (c.kind === "absence") absent++;
    else empty++;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {[...groups.values()].map((g) => (
        <span key={g.label} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: g.color ?? "#64748b" }}>
          {g.label} × {g.n}
        </span>
      ))}
      {off > 0 && <span className="badge">{t("schedule.off")} × {off}</span>}
      {absent > 0 && <span className="badge bg-amber-100 text-amber-800">{t("schedule.absent")} × {absent}</span>}
      {empty > 0 && <span className="badge border border-dashed border-gray-300 bg-transparent">{t("schedule.notPlanned")} × {empty}</span>}
    </div>
  );
}

function ToolButton({ active, onClick, children, style }: { active: boolean; onClick: () => void; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 rounded-md border px-2.5 py-1 text-xs font-semibold ${active ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
      style={style}
    >
      {children}
    </button>
  );
}
