import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { departments, shiftTemplates } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { formatHours, formatSegments } from "@/lib/shifts";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createShift, updateShift } from "./actions";

type Dep = { id: string; name: string };

function ShiftFields({
  deps,
  value,
}: {
  deps: Dep[];
  value?: { code: string; name: string; color: string; segments: string; breakMinutes: number; departmentId: string | null };
}) {
  return (
    <>
      <div className="w-20">
        <label className="label">Code</label>
        <input name="code" defaultValue={value?.code} className="input uppercase" maxLength={6} required />
      </div>
      <div className="min-w-36 flex-1">
        <label className="label">Name</label>
        <input name="name" defaultValue={value?.name} className="input" required />
      </div>
      <div className="min-w-56 flex-[2]">
        <label className="label">Hours (split with “/”)</label>
        <input
          name="segments"
          defaultValue={value?.segments}
          className="input font-mono"
          placeholder="09:00-11:00 / 15:00-20:00"
          required
        />
      </div>
      <div className="w-24">
        <label className="label">Unpaid break (min)</label>
        <input name="breakMinutes" type="number" min={0} defaultValue={value?.breakMinutes ?? 0} className="input" />
      </div>
      <div className="w-40">
        <label className="label">Department</label>
        <select name="departmentId" defaultValue={value?.departmentId ?? ""} className="input">
          <option value="">All departments</option>
          {deps.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Colour</label>
        <input name="color" type="color" defaultValue={value?.color ?? "#3b82f6"} className="h-9 w-12 rounded border border-gray-300" />
      </div>
    </>
  );
}

export default async function ShiftsPage() {
  await requireUser(["admin", "top_manager"]);
  const [deps, rows] = await Promise.all([
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.active, true)).orderBy(asc(departments.name)),
    db.select().from(shiftTemplates).orderBy(asc(shiftTemplates.code)),
  ]);

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="page-title">Shift legends</h1>
        <p className="text-sm text-gray-500">
          Each legend is a code managers pick in the schedule. Overnight blocks (e.g. 23:00-07:00) are supported.
        </p>
      </div>

      <div className="card">
        <h2 className="mb-3 font-medium">New legend</h2>
        <ActionForm action={createShift} resetOnSuccess className="flex flex-wrap items-end gap-3">
          <ShiftFields deps={deps} />
          <SubmitButton>Add</SubmitButton>
        </ActionForm>
      </div>

      <div className="space-y-3">
        {rows.map((s) => (
          <details key={s.id} className={`card ${s.active ? "" : "opacity-60"}`}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-3">
              <span className="inline-flex h-7 min-w-10 items-center justify-center rounded px-2 text-sm font-semibold text-white" style={{ background: s.color }}>
                {s.code}
              </span>
              <span className="font-medium">{s.name}</span>
              <span className="font-mono text-sm text-gray-600">{formatSegments(s.segments)}</span>
              {s.breakMinutes > 0 && <span className="text-sm text-gray-500">− {s.breakMinutes} min break</span>}
              <span className="badge">{formatHours(s.paidMinutes)} h paid</span>
              {s.departmentId && <span className="badge">{deps.find((d) => d.id === s.departmentId)?.name}</span>}
              {!s.active && <span className="badge">inactive</span>}
            </summary>
            <ActionForm action={updateShift} className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={s.id} />
              <ShiftFields
                deps={deps}
                value={{
                  code: s.code,
                  name: s.name,
                  color: s.color,
                  segments: s.segments.map((x) => `${x.start}-${x.end}`).join(" / "),
                  breakMinutes: s.breakMinutes,
                  departmentId: s.departmentId,
                }}
              />
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={s.active} /> Active
              </label>
              <SubmitButton className="btn">Save</SubmitButton>
            </ActionForm>
          </details>
        ))}
      </div>
    </div>
  );
}
