"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { copyPreviousWeek, saveCells, type Tool } from "@/app/(app)/schedule/actions";
import { EMPTY_CELL, viewOfTool, type CellView, type TemplateLite } from "@/lib/cell-view";
import { ABSENCE_CODES } from "@/lib/codes";
import { dayLabel, isWeekend } from "@/lib/calendar";
import { costCents, rateAt, type RateBookJSON } from "@/lib/rates";
import { formatHours } from "@/lib/shifts";
import { formatEur } from "@/lib/money";

type Props = {
  departmentId: string;
  dates: string[];
  employees: { id: string; name: string; position: string | null }[];
  initialCells: Record<string, CellView>;
  approved: Record<string, true>;
  templates: TemplateLite[];
  rates: RateBookJSON;
  factor: number;
  editable: boolean;
  today: string;
  budget: { month: string; budgetCents: number | null; projectedCents: number } | null;
  weekStart: string | null;
  /** False for employees viewing the department schedule: no money shown. */
  showCost?: boolean;
};

const k = (employeeId: string, date: string) => `${employeeId}|${date}`;

export function ScheduleGrid(props: Props) {
  const { departmentId, dates, employees, templates, rates, factor, editable, today, budget, weekStart, showCost = true } = props;
  const router = useRouter();

  // Reset local state whenever the server sends fresh data.
  const [base, setBase] = useState(props.initialCells);
  const [cells, setCells] = useState(props.initialCells);
  const [budgetDelta, setBudgetDelta] = useState(0);
  if (base !== props.initialCells) {
    setBase(props.initialCells);
    setCells(props.initialCells);
    setBudgetDelta(0);
  }

  const [tool, setTool] = useState<Tool | null>(null);
  const [customText, setCustomText] = useState("08:00-16:00");
  const [status, setStatus] = useState<{ saving: number; error: string | null }>({ saving: 0, error: null });
  const [copying, startCopy] = useTransition();
  const painting = useRef(false);
  const queue = useRef(new Map<string, { employeeId: string; date: string; tool: Tool }>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stop = () => (painting.current = false);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

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

  function apply(employeeId: string, date: string) {
    if (!editable || !tool) return;
    const effective: Tool = tool.type === "custom" ? { type: "custom", text: customText } : tool;
    const view = viewOfTool(effective, templates);
    if (!view) {
      setStatus((s) => ({ ...s, error: 'Custom hours must look like "08:00-12:00 / 17:00-21:00"' }));
      return;
    }
    const key = k(employeeId, date);
    const old = cells[key] ?? EMPTY_CELL;
    if (old.label === view.label && old.kind === view.kind && old.paidMinutes === view.paidMinutes) return;

    setCells((c) => ({ ...c, [key]: view }));
    if (budget && date.startsWith(budget.month) && !props.approved[key]) {
      setBudgetDelta((d) => d + cost(employeeId, date, view.paidMinutes) - cost(employeeId, date, old.paidMinutes));
    }
    queue.current.set(key, { employeeId, date, tool: effective });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 400);
  }

  const totals = employees.map((e) => {
    let minutes = 0;
    let cents = 0;
    for (const d of dates) {
      const c = cells[k(e.id, d)];
      if (c?.paidMinutes) {
        minutes += c.paidMinutes;
        cents += cost(e.id, d, c.paidMinutes);
      }
    }
    return { minutes, cents };
  });
  const dayTotals = dates.map((d) => employees.reduce((sum, e) => sum + (cells[k(e.id, d)]?.paidMinutes ?? 0), 0));
  const grandMinutes = totals.reduce((s, t) => s + t.minutes, 0);
  const grandCents = totals.reduce((s, t) => s + t.cents, 0);

  const projected = budget ? budget.projectedCents + budgetDelta : 0;
  const over = budget?.budgetCents ? projected > budget.budgetCents : false;

  const toolKey = (t: Tool | null) => (t ? JSON.stringify(t) : "");
  const toolProps = (t: Tool) => ({
    active: toolKey(tool) === toolKey(t),
    onClick: () => setTool(toolKey(tool) === toolKey(t) ? null : t),
  });

  return (
    <div className="space-y-3">
      {budget && (
        <div className={`card flex flex-wrap items-center gap-x-6 gap-y-1 py-3 text-sm ${over ? "border-red-200 bg-red-50" : ""}`}>
          <div>
            <span className="text-gray-500">Month projected cost: </span>
            <span className="font-semibold tabular-nums">{formatEur(projected)}</span>
          </div>
          <div>
            <span className="text-gray-500">Budget: </span>
            <span className="font-semibold tabular-nums">{budget.budgetCents ? formatEur(budget.budgetCents) : "not set"}</span>
          </div>
          {budget.budgetCents ? (
            <div className={over ? "font-medium text-red-700" : "text-green-700"}>
              {over ? "Over by " : "Left: "}
              {formatEur(Math.abs(budget.budgetCents - projected))}
            </div>
          ) : null}
        </div>
      )}

      {editable && (
        <div className="card sticky top-0 z-20 space-y-2 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-gray-500">Paint:</span>
            {templates.map((t) => (
              <ToolButton key={t.id} {...toolProps({ type: "template", templateId: t.id })} style={{ background: t.color, color: "white", borderColor: t.color }}>
                <span title={`${t.name} (${formatHours(t.paidMinutes)} h)`}>{t.code}</span>
              </ToolButton>
            ))}
            <ToolButton {...toolProps({ type: "off" })}>Off</ToolButton>
            {ABSENCE_CODES.map((a) => (
              <ToolButton key={a.code} {...toolProps({ type: "absence", code: a.code })}>
                <span title={a.label}>{a.code}</span>
              </ToolButton>
            ))}
            <ToolButton {...toolProps({ type: "custom", text: "" })}>Custom</ToolButton>
            {tool?.type === "custom" && (
              <input value={customText} onChange={(e) => setCustomText(e.target.value)} className="input w-48 py-1 font-mono text-xs" placeholder="08:00-12:00 / 17:00-21:00" />
            )}
            <ToolButton {...toolProps({ type: "none" })}>Clear</ToolButton>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span>{tool ? "Click or drag across cells to fill." : "Pick a legend above, then click or drag across cells. With nothing picked, clicking a cell shows its history."}</span>
            {weekStart && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={copying}
                onClick={() => {
                  if (!confirm("Copy last week's schedule onto this week? Existing cells this week are overwritten.")) return;
                  startCopy(async () => {
                    const res = await copyPreviousWeek(departmentId, weekStart, employees.map((e) => e.id));
                    setStatus((s) => ({ ...s, error: res.error ?? null }));
                    router.refresh();
                  });
                }}
              >
                {copying ? "Copying…" : "Copy previous week"}
              </button>
            )}
            <span className="ml-auto">
              {status.saving > 0 ? "Saving…" : status.error ? <span className="text-red-600">{status.error}</span> : "All changes saved"}
            </span>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto p-0 sm:p-0">
        <table className="w-full border-collapse text-sm select-none">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-40 border-b border-gray-200 bg-white px-3 py-2 text-left text-xs font-medium text-gray-500">Employee</th>
              {dates.map((d) => (
                <th
                  key={d}
                  className={`min-w-12 border-b border-l border-gray-200 px-1 py-2 text-center text-[11px] font-medium ${
                    d === today ? "bg-blue-50 text-blue-700" : isWeekend(d) ? "bg-gray-50 text-gray-500" : "text-gray-500"
                  }`}
                >
                  {dayLabel(d).split(" ")[0]}
                  <br />
                  {d.slice(8, 10)}
                </th>
              ))}
              <th className="border-b border-l border-gray-200 px-2 py-2 text-right text-xs font-medium text-gray-500">Hours</th>
              {showCost && <th className="border-b border-l border-gray-200 px-2 py-2 text-right text-xs font-medium text-gray-500">Cost</th>}
            </tr>
          </thead>
          <tbody>
            {employees.map((e, i) => (
              <tr key={e.id}>
                <td className="sticky left-0 z-10 border-b border-gray-100 bg-white px-3 py-1.5">
                  <div className="font-medium whitespace-nowrap">{e.name}</div>
                  {e.position && <div className="text-xs text-gray-500">{e.position}</div>}
                </td>
                {dates.map((d) => {
                  const key = k(e.id, d);
                  const c = cells[key] ?? EMPTY_CELL;
                  const inner = (
                    <span
                      className={`inline-flex h-7 w-full min-w-10 items-center justify-center rounded text-xs font-semibold ${
                        c.kind === "shift" ? "text-white" : c.kind === "absence" ? "bg-amber-100 text-amber-800" : "text-gray-400"
                      }`}
                      style={c.kind === "shift" ? { background: c.color ?? "#64748b" } : undefined}
                    >
                      {c.label}
                    </span>
                  );
                  return (
                    <td
                      key={d}
                      title={c.title + (props.approved[key] ? " · Forma 76 approved" : "")}
                      className={`relative border-b border-l border-gray-100 p-0.5 text-center ${isWeekend(d) ? "bg-gray-50" : ""} ${
                        editable && tool ? "cursor-crosshair" : ""
                      }`}
                      onPointerDown={(ev) => {
                        if (!tool) return;
                        ev.preventDefault();
                        painting.current = true;
                        apply(e.id, d);
                      }}
                      onPointerEnter={() => painting.current && apply(e.id, d)}
                    >
                      {!tool && showCost ? (
                        <Link href={`/schedule/history?employee=${e.id}&date=${d}`} className="block">
                          {inner}
                        </Link>
                      ) : (
                        inner
                      )}
                      {props.approved[key] && <span className="absolute top-0 right-0.5 text-[9px] text-green-600">✓</span>}
                    </td>
                  );
                })}
                <td className="border-b border-l border-gray-100 px-2 text-right tabular-nums">{formatHours(totals[i].minutes)}</td>
                {showCost && <td className="border-b border-l border-gray-100 px-2 text-right whitespace-nowrap tabular-nums">{formatEur(totals[i].cents)}</td>}
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={dates.length + 3} className="py-8 text-center text-gray-500">
                  No employees in this department.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 text-xs text-gray-600">
              <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 font-medium">Total hours</td>
              {dayTotals.map((m, i) => (
                <td key={dates[i]} className="border-l border-gray-100 text-center tabular-nums">{m ? formatHours(m) : ""}</td>
              ))}
              <td className="border-l border-gray-100 px-2 text-right font-semibold tabular-nums">{formatHours(grandMinutes)}</td>
              {showCost && <td className="border-l border-gray-100 px-2 text-right font-semibold whitespace-nowrap tabular-nums">{formatEur(grandCents)}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={`text-xs text-gray-500 ${showCost ? "" : "hidden"}`}>
        Cost = paid hours × hourly rate × employer cost factor ({factor}). ✓ = day already approved in Forma 76. “*” = legend changed after this day was planned.
      </p>
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  children,
  style,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-1 text-xs font-semibold ${active ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
      style={style}
    >
      {children}
    </button>
  );
}
