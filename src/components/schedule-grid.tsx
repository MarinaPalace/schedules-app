"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { copyPreviousWeek, publishSchedule, saveCells, type Tool } from "@/app/(app)/schedule/actions";
import { EMPTY_CELL, viewOfTool, type CellView, type TemplateLite } from "@/lib/cell-view";
import { ABSENCE_CODES } from "@/lib/codes";
import { dayLabel, isWeekend } from "@/lib/calendar";
import { costCents, rateAt, type RateBookJSON } from "@/lib/rates";
import { formatHours } from "@/lib/shifts";
import { formatEur } from "@/lib/money";
import { useLocale, useTranslations } from "next-intl";
import { useDayLabels } from "@/lib/use-day-labels";

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
  /** Cells whose current plan employees cannot see yet. */
  unpublished?: Record<string, true>;
};

const k = (employeeId: string, date: string) => `${employeeId}|${date}`;

export function ScheduleGrid(props: Props) {
  const { departmentId, dates, employees, templates, rates, factor, editable, today, budget, weekStart, showCost = true } = props;
  const router = useRouter();
  const t = useTranslations();
  const locale = useLocale();
  const labels = useDayLabels();

  // Reset local state whenever the server sends fresh data.
  const [base, setBase] = useState(props.initialCells);
  const [cells, setCells] = useState(props.initialCells);
  const [budgetDelta, setBudgetDelta] = useState(0);
  const [unpub, setUnpub] = useState(props.unpublished ?? {});
  if (base !== props.initialCells) {
    setBase(props.initialCells);
    setCells(props.initialCells);
    setBudgetDelta(0);
    setUnpub(props.unpublished ?? {});
  }

  const [tool, setTool] = useState<Tool | null>(null);
  const [customText, setCustomText] = useState("08:00-16:00");
  const [status, setStatus] = useState<{ saving: number; error: string | null }>({ saving: 0, error: null });
  const [copying, startCopy] = useTransition();
  const [publishing, startPublish] = useTransition();
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
    const view = viewOfTool(effective, templates, labels);
    if (!view) {
      setStatus((s) => ({ ...s, error: t("schedule.customFormat") }));
      return;
    }
    const key = k(employeeId, date);
    const old = cells[key] ?? EMPTY_CELL;
    if (old.label === view.label && old.kind === view.kind && old.paidMinutes === view.paidMinutes) return;

    setCells((c) => ({ ...c, [key]: view }));
    setUnpub((u) => ({ ...u, [key]: true }));
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

  const unpublishedCount = Object.keys(unpub).filter((key) => dates.includes(key.split("|")[1])).length;

  const projected = budget ? budget.projectedCents + budgetDelta : 0;
  const over = budget?.budgetCents ? projected > budget.budgetCents : false;

  const toolKey = (x: Tool | null) => (x ? JSON.stringify(x) : "");
  const toolProps = (x: Tool) => ({
    active: toolKey(tool) === toolKey(x),
    onClick: () => setTool(toolKey(tool) === toolKey(x) ? null : x),
  });

  return (
    <div className="space-y-3">
      {budget && (
        <div className={`card flex flex-wrap items-center gap-x-6 gap-y-1 py-3 text-sm ${over ? "border-red-200 bg-red-50" : ""}`}>
          <div>
            <span className="text-gray-500">{t("schedule.monthProjected")} </span>
            <span className="font-semibold tabular-nums">{formatEur(projected)}</span>
          </div>
          <div>
            <span className="text-gray-500">{t("common.budget")}: </span>
            <span className="font-semibold tabular-nums">{budget.budgetCents ? formatEur(budget.budgetCents) : t("common.notSet")}</span>
          </div>
          {budget.budgetCents ? (
            <div className={over ? "font-medium text-red-700" : "text-green-700"}>
              {over ? `${t("schedule.overBy")} ` : `${t("schedule.left")} `}
              {formatEur(Math.abs(budget.budgetCents - projected))}
            </div>
          ) : null}
        </div>
      )}

      {editable && (
        <div className="card sticky top-0 z-20 space-y-2 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-gray-500">{t("schedule.paint")}</span>
            {templates.map((tpl) => (
              <ToolButton key={tpl.id} {...toolProps({ type: "template", templateId: tpl.id })} style={{ background: tpl.color, color: "white", borderColor: tpl.color }}>
                <span title={`${tpl.name} (${formatHours(tpl.paidMinutes)} ${labels.hourUnit})`}>{tpl.code}</span>
              </ToolButton>
            ))}
            <ToolButton {...toolProps({ type: "off" })}>{t("schedule.off")}</ToolButton>
            {ABSENCE_CODES.map((code) => (
              <ToolButton key={code} {...toolProps({ type: "absence", code })}>
                <span title={labels.absence[code]}>{code}</span>
              </ToolButton>
            ))}
            <ToolButton {...toolProps({ type: "custom", text: "" })}>{t("schedule.custom")}</ToolButton>
            {tool?.type === "custom" && (
              <input value={customText} onChange={(e) => setCustomText(e.target.value)} className="input w-48 py-1 font-mono text-xs" placeholder="08:00-12:00 / 17:00-21:00" />
            )}
            <ToolButton {...toolProps({ type: "none" })}>{t("schedule.clear")}</ToolButton>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span>{tool ? t("schedule.hintTool") : t("schedule.hintNoTool")}</span>
            {weekStart && (
              <button
                type="button"
                className="btn btn-sm"
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
                {copying ? t("schedule.copying") : t("schedule.copyWeek")}
              </button>
            )}
            <button
              type="button"
              className={`btn btn-sm ${unpublishedCount ? "btn-primary" : ""}`}
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
            <span className="ml-auto">
              {status.saving > 0 ? t("schedule.saving") : status.error ? <span className="text-red-600">{status.error}</span> : t("schedule.allSaved")}
            </span>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto p-0 sm:p-0">
        <table className="w-full border-collapse text-sm select-none">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-40 border-b border-gray-200 bg-white px-3 py-2 text-left text-xs font-medium text-gray-500">{t("common.employee")}</th>
              {dates.map((d) => (
                <th
                  key={d}
                  className={`min-w-12 border-b border-l border-gray-200 px-1 py-2 text-center text-[11px] font-medium ${
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
                      title={c.title + (props.approved[key] ? ` · ${t("schedule.approvedMark")}` : "")}
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
                      {editable && unpub[key] && <span className="absolute top-0.5 left-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" title={t("schedule.notPublished")} />}
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
                  {t("schedule.noEmployees")}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 text-xs text-gray-600">
              <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 font-medium">{t("common.totalHours")}</td>
              {dayTotals.map((m, i) => (
                <td key={dates[i]} className="border-l border-gray-100 text-center tabular-nums">{m ? formatHours(m) : ""}</td>
              ))}
              <td className="border-l border-gray-100 px-2 text-right font-semibold tabular-nums">{formatHours(grandMinutes)}</td>
              {showCost && <td className="border-l border-gray-100 px-2 text-right font-semibold whitespace-nowrap tabular-nums">{formatEur(grandCents)}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={`text-xs text-gray-500 ${showCost ? "" : "hidden"}`}>{t("schedule.footnote", { factor })}</p>
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
