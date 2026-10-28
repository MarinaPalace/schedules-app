"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDay, requestCorrection } from "@/app/(app)/timesheet/actions";
import { ABSENCE_CODES } from "@/lib/codes";
import { toDayValue, type DayInput } from "@/lib/day-input";
import { formatHours } from "@/lib/shifts";
import { useTranslations } from "next-intl";
import { useDayLabels } from "@/lib/use-day-labels";

export type TimesheetRow = {
  employeeId: string;
  name: string;
  position: string | null;
  planned: string;
  plannedInput: DayInput;
  approved: { version: number; text: string; input: DayInput } | null;
  pending: { text: string; reason: string } | null;
};

function without<T>(obj: Record<string, T>, k: string): Record<string, T> {
  const copy = { ...obj };
  delete copy[k];
  return copy;
}

function encodeKind(i: DayInput) {
  return i.kind === "absence" ? `absence:${i.absenceCode ?? ""}` : i.kind;
}
function decodeKind(v: string, prev: DayInput): DayInput {
  if (v.startsWith("absence:")) return { ...prev, kind: "absence", absenceCode: v.slice(8) };
  return { ...prev, kind: v as DayInput["kind"], absenceCode: null };
}

function DayEditor({ value, onChange, disabled }: { value: DayInput; onChange: (v: DayInput) => void; disabled?: boolean }) {
  const t = useTranslations();
  const labels = useDayLabels();
  const parsed = toDayValue(value);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input w-auto py-1" value={encodeKind(value)} disabled={disabled} onChange={(e) => onChange(decodeKind(e.target.value, value))}>
        <option value="shift">{t("timesheet.worked")}</option>
        <option value="off">{t("common.dayOff")}</option>
        {ABSENCE_CODES.map((code) => (
          <option key={code} value={`absence:${code}`}>
            {code} – {labels.absence[code]}
          </option>
        ))}
        <option value="none">{t("timesheet.nothing")}</option>
      </select>
      {value.kind === "shift" && (
        <>
          <input
            className="input w-52 py-1 font-mono text-xs"
            value={value.hours}
            disabled={disabled}
            placeholder="08:00-16:00"
            onChange={(e) => onChange({ ...value, hours: e.target.value })}
          />
          <label className="flex items-center gap-1 text-xs text-gray-500">
            {t("timesheet.break")}
            <input
              type="number"
              min={0}
              className="input w-16 py-1 text-xs"
              value={value.breakMinutes}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, breakMinutes: Number(e.target.value) || 0 })}
            />
            {t("timesheet.min")}
          </label>
        </>
      )}
      <span className={`text-xs ${typeof parsed === "string" ? "text-red-600" : "text-gray-600"}`}>
        {typeof parsed === "string" ? t(`errors.${parsed}`) : `${formatHours(parsed.paidMinutes)} ${labels.hourUnit}`}
      </span>
    </div>
  );
}

export function TimesheetDay({
  departmentId,
  date,
  rows,
  editable,
  canApproveDate,
}: {
  departmentId: string;
  date: string;
  rows: TimesheetRow[];
  editable: boolean;
  canApproveDate: boolean;
}) {
  const router = useRouter();
  const t = useTranslations();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const open = rows.filter((r) => !r.approved);

  const [inputs, setInputs] = useState<Record<string, DayInput>>(() => Object.fromEntries(open.map((r) => [r.employeeId, r.plannedInput])));
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(open.map((r) => [r.employeeId, r.plannedInput.kind !== "none"])),
  );
  const [editing, setEditing] = useState<Record<string, { input: DayInput; reason: string }>>({});

  const chosen = open.filter((r) => selected[r.employeeId]);

  function approve() {
    setMsg({});
    start(async () => {
      const res = await approveDay({
        departmentId,
        date,
        rows: chosen.map((r) => ({ employeeId: r.employeeId, input: inputs[r.employeeId] })),
      });
      setMsg(res);
      if (!res.error) router.refresh();
    });
  }

  function sendCorrection(employeeId: string) {
    const ed = editing[employeeId];
    setMsg({});
    start(async () => {
      const res = await requestCorrection({ departmentId, employeeId, date, input: ed.input, reason: ed.reason });
      setMsg(res);
      if (!res.error) {
        setEditing((s) => without(s, employeeId));
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="card overflow-x-auto p-0 sm:p-0">
        <table className="table table-stack">
          <thead>
            <tr>
              {editable && open.length > 0 && <th className="w-8"></th>}
              <th>{t("common.employee")}</th>
              <th>{t("timesheet.planned")}</th>
              <th>{t("timesheet.actualCol")}</th>
              <th>{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ed = editing[r.employeeId];
              return (
                <tr key={r.employeeId} className="align-top">
                  {editable && open.length > 0 && (
                    <td className="max-md:float-right max-md:w-auto!">
                      {!r.approved && (
                        <input
                          type="checkbox"
                          className="h-6 w-6 md:h-4 md:w-4"
                          aria-label={r.name}
                          checked={!!selected[r.employeeId]}
                          disabled={!canApproveDate}
                          onChange={(e) => setSelected((s) => ({ ...s, [r.employeeId]: e.target.checked }))}
                        />
                      )}
                    </td>
                  )}
                  <td>
                    <div className="font-medium whitespace-nowrap">{r.name}</div>
                    {r.position && <div className="text-xs text-gray-500">{r.position}</div>}
                  </td>
                  <td data-label={t("timesheet.planned")} className="text-xs whitespace-nowrap text-gray-600">{r.planned}</td>
                  <td data-label={t("timesheet.actualCol")}>
                    {!r.approved ? (
                      editable ? (
                        <DayEditor value={inputs[r.employeeId]} disabled={!canApproveDate} onChange={(v) => setInputs((s) => ({ ...s, [r.employeeId]: v }))} />
                      ) : (
                        <span className="text-gray-400">{t("timesheet.notApproved")}</span>
                      )
                    ) : ed ? (
                      <div className="space-y-2">
                        <DayEditor value={ed.input} onChange={(v) => setEditing((s) => ({ ...s, [r.employeeId]: { ...ed, input: v } }))} />
                        <input
                          className="input py-1 text-sm"
                          placeholder={t("timesheet.reasonPlaceholder")}
                          value={ed.reason}
                          onChange={(e) => setEditing((s) => ({ ...s, [r.employeeId]: { ...ed, reason: e.target.value } }))}
                        />
                        <div className="flex gap-2">
                          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => sendCorrection(r.employeeId)}>
                            {t("timesheet.sendForApproval")}
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => setEditing((s) => without(s, r.employeeId))}>
                            {t("common.cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm">{r.approved.text}</div>
                    )}
                    {r.pending && (
                      <div className="mt-1 text-xs text-amber-700">
                        {t("timesheet.waitingFor", { text: r.pending.text, reason: r.pending.reason })}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap max-md:pt-2">
                    {r.approved ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className="badge bg-green-100 text-green-800">{r.approved.version > 1 ? t("timesheet.approvedVersion", { version: r.approved.version }) : t("common.approved")}</span>
                        {editable && !r.pending && !ed && (
                          <button
                            type="button"
                            className="text-sm text-blue-700 hover:underline max-md:min-h-11"
                            onClick={() => setEditing((s) => ({ ...s, [r.employeeId]: { input: r.approved!.input, reason: "" } }))}
                          >
                            {t("timesheet.change")}
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="badge">{t("common.open")}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-gray-500">{t("timesheet.noEmployees")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editable && open.length > 0 && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-surface p-3 shadow-lg md:static md:border-0 md:bg-transparent md:p-0 md:shadow-none">
          <button
            type="button"
            className="btn"
            onClick={() => setSelected(Object.fromEntries(open.map((r) => [r.employeeId, !open.every((x) => selected[x.employeeId])])))}
            disabled={!canApproveDate}
          >
            {open.every((x) => selected[x.employeeId]) ? t("timesheet.selectNone") : t("timesheet.selectAll")}
          </button>
          <button type="button" className="btn btn-primary min-h-12 flex-1 md:flex-none" disabled={pending || !canApproveDate || chosen.length === 0} onClick={approve}>
            {pending ? t("schedule.saving") : t("timesheet.approveSelected", { count: chosen.length })}
          </button>
          {!canApproveDate && <span className="text-sm text-gray-500">{t("timesheet.futureNote")}</span>}
          <span className="text-xs text-gray-500 max-md:w-full">{t("timesheet.lockNote")}</span>
        </div>
      )}
      {msg.error && <p className="text-sm text-red-600">{msg.error}</p>}
      {msg.ok && <p className="text-sm text-green-700">{msg.ok}</p>}
    </div>
  );
}
