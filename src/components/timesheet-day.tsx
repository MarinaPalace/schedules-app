"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDay, requestCorrection } from "@/app/(app)/timesheet/actions";
import { ABSENCE_CODES } from "@/lib/codes";
import { toDayValue, type DayInput } from "@/lib/day-input";
import { formatHours } from "@/lib/shifts";

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
  const parsed = toDayValue(value);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input w-auto py-1" value={encodeKind(value)} disabled={disabled} onChange={(e) => onChange(decodeKind(e.target.value, value))}>
        <option value="shift">Worked</option>
        <option value="off">Day off</option>
        {ABSENCE_CODES.map((a) => (
          <option key={a.code} value={`absence:${a.code}`}>
            {a.code} – {a.label}
          </option>
        ))}
        <option value="none">— nothing</option>
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
            break
            <input
              type="number"
              min={0}
              className="input w-16 py-1 text-xs"
              value={value.breakMinutes}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, breakMinutes: Number(e.target.value) || 0 })}
            />
            min
          </label>
        </>
      )}
      <span className={`text-xs ${typeof parsed === "string" ? "text-red-600" : "text-gray-600"}`}>
        {typeof parsed === "string" ? parsed : `${formatHours(parsed.paidMinutes)} h`}
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
        <table className="table">
          <thead>
            <tr>
              {editable && open.length > 0 && <th className="w-8"></th>}
              <th>Employee</th>
              <th>Planned</th>
              <th>Actual (Forma 76)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ed = editing[r.employeeId];
              return (
                <tr key={r.employeeId} className="align-top">
                  {editable && open.length > 0 && (
                    <td>
                      {!r.approved && (
                        <input
                          type="checkbox"
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
                  <td className="text-xs whitespace-nowrap text-gray-600">{r.planned}</td>
                  <td>
                    {!r.approved ? (
                      editable ? (
                        <DayEditor value={inputs[r.employeeId]} disabled={!canApproveDate} onChange={(v) => setInputs((s) => ({ ...s, [r.employeeId]: v }))} />
                      ) : (
                        <span className="text-gray-400">not approved</span>
                      )
                    ) : ed ? (
                      <div className="space-y-2">
                        <DayEditor value={ed.input} onChange={(v) => setEditing((s) => ({ ...s, [r.employeeId]: { ...ed, input: v } }))} />
                        <input
                          className="input py-1 text-sm"
                          placeholder="Reason for the change (required)"
                          value={ed.reason}
                          onChange={(e) => setEditing((s) => ({ ...s, [r.employeeId]: { ...ed, reason: e.target.value } }))}
                        />
                        <div className="flex gap-2">
                          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => sendCorrection(r.employeeId)}>
                            Send for approval
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => setEditing((s) => without(s, r.employeeId))}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm">{r.approved.text}</div>
                    )}
                    {r.pending && (
                      <div className="mt-1 text-xs text-amber-700">
                        Waiting for approval → {r.pending.text} ({r.pending.reason})
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    {r.approved ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className="badge bg-green-100 text-green-800">approved{r.approved.version > 1 ? ` v${r.approved.version}` : ""}</span>
                        {editable && !r.pending && !ed && (
                          <button
                            type="button"
                            className="text-xs text-blue-700 hover:underline"
                            onClick={() => setEditing((s) => ({ ...s, [r.employeeId]: { input: r.approved!.input, reason: "" } }))}
                          >
                            Change…
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="badge">open</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-gray-500">No employees.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editable && open.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={pending || !canApproveDate || chosen.length === 0} onClick={approve}>
            {pending ? "Saving…" : `Approve ${chosen.length} selected`}
          </button>
          {!canApproveDate && <span className="text-sm text-gray-500">Days in the future cannot be approved.</span>}
          <span className="text-xs text-gray-500">After approval a day is locked; changes go to the top manager.</span>
        </div>
      )}
      {msg.error && <p className="text-sm text-red-600">{msg.error}</p>}
      {msg.ok && <p className="text-sm text-green-700">{msg.ok}</p>}
    </div>
  );
}
