import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { departments, shiftTemplates } from "@/db/schema";
import { PEOPLE_ADMINS, requireUser, staffDepartments, STAFF_EDITORS } from "@/lib/session";
import { PageHelp } from "@/components/page-help";
import { EmptyState } from "@/components/empty-state";
import { formatHours, formatSegments } from "@/lib/shifts";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createShift, updateShift } from "./actions";
import { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations<never>>>;

type Dep = { id: string; name: string };

function ShiftFields({
  deps,
  value,
  t,
  hotelWide = true,
}: {
  t: T;
  deps: Dep[];
  /** May make a legend for all departments (owner/GM/admin). */
  hotelWide?: boolean;
  value?: { code: string; name: string; color: string; segments: string; breakMinutes: number; departmentId: string | null };
}) {
  return (
    <>
      <div className="w-20">
        <label className="label">{t("shifts.code")}</label>
        <input name="code" defaultValue={value?.code} className="input uppercase" maxLength={6} required />
      </div>
      <div className="min-w-36 flex-1">
        <label className="label">{t("common.name")}</label>
        <input name="name" defaultValue={value?.name} className="input" required />
      </div>
      <div className="min-w-56 flex-[2]">
        <label className="label">{t("shifts.hoursSplit")}</label>
        <input
          name="segments"
          defaultValue={value?.segments}
          className="input font-mono"
          placeholder="09:00-11:00 / 15:00-20:00"
          required
        />
      </div>
      <div className="w-24">
        <label className="label">{t("shifts.unpaidBreak")}</label>
        <input name="breakMinutes" type="number" min={0} defaultValue={value?.breakMinutes ?? 0} className="input" />
      </div>
      <div className="w-40">
        <label className="label">{t("common.department")}</label>
        <select name="departmentId" defaultValue={value?.departmentId ?? ""} className="input">
          {hotelWide && <option value="">{t("common.allDepartments")}</option>}
          {deps.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">{t("shifts.colour")}</label>
        <input name="color" type="color" defaultValue={value?.color ?? "#3b82f6"} className="h-9 w-12 rounded border border-gray-300" />
      </div>
    </>
  );
}

export default async function ShiftsPage() {
  const me = await requireUser(STAFF_EDITORS);
  const t = await getTranslations();
  const all = PEOPLE_ADMINS.includes(me.role);
  // Managers: their departments' legends (editable) and the hotel-wide ones (to see what exists).
  const deps = all
    ? await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.active, true)).orderBy(asc(departments.name))
    : (await staffDepartments(me)).map(({ id, name }) => ({ id, name }));
  const rows = (await db.select().from(shiftTemplates).orderBy(asc(shiftTemplates.code))).filter((s) => all || !s.departmentId || deps.some((d) => d.id === s.departmentId));
  const canEdit = (s: (typeof rows)[number]) => all || (!!s.departmentId && deps.some((d) => d.id === s.departmentId));

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="page-title">{t("shifts.title")}</h1>
          <PageHelp text={t("help.shifts")} />
        </div>
        <p className="text-sm text-gray-500">{t("shifts.help")}</p>
      </div>

      <div className="card">
        <h2 className="mb-3 font-medium">{t("shifts.new")}</h2>
        <ActionForm action={createShift} resetOnSuccess className="flex flex-wrap items-end gap-3">
          <ShiftFields t={t} deps={deps} hotelWide={all} />
          <SubmitButton>{t("common.add")}</SubmitButton>
        </ActionForm>
      </div>

      {rows.length === 0 && <EmptyState icon="schedule" title={t("empty.legendsTitle")} text={t("empty.legendsText")} />}
      <div className="space-y-3">
        {rows.map((s) => (
          <details key={s.id} className={`card ${s.active ? "" : "opacity-60"}`}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-3">
              <span className="inline-flex h-7 min-w-10 items-center justify-center rounded px-2 text-sm font-semibold text-white" style={{ background: s.color }}>
                {s.code}
              </span>
              <span className="font-medium">{s.name}</span>
              <span className="font-mono text-sm text-gray-600">{formatSegments(s.segments)}</span>
              {s.breakMinutes > 0 && <span className="text-sm text-gray-500">{t("shifts.breakNote", { minutes: s.breakMinutes })}</span>}
              <span className="badge">{t("shifts.paid", { hours: formatHours(s.paidMinutes) })}</span>
              <span className="badge">{s.departmentId ? deps.find((d) => d.id === s.departmentId)?.name : t("shifts.hotelWide")}</span>
              {!s.active && <span className="badge">{t("common.inactive")}</span>}
            </summary>
            {canEdit(s) ? (
            <ActionForm action={updateShift} className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={s.id} />
              <ShiftFields
                t={t}
                deps={deps}
                hotelWide={all}
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
                <input type="checkbox" name="active" defaultChecked={s.active} /> {t("common.active")}
              </label>
              <SubmitButton className="btn">{t("common.save")}</SubmitButton>
            </ActionForm>
            ) : (
              <p className="mt-3 text-sm text-gray-500">{t("shifts.hotelWideNote")}</p>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}
