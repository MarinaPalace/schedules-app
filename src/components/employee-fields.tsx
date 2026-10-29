"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { LocationLite, RoleLite } from "@/lib/org-types";
import { suggestUsername } from "@/lib/translit";
import type { Role } from "@/lib/session";

type Dept = { id: string; name: string; roles: RoleLite[]; places: LocationLite[] };

/**
 * Fields for a new employee: the department decides which positions and places can be chosen,
 * the username is suggested from the name, and pay can be typed per hour or per month.
 */
export function EmployeeFields({ departments, defaultDept, access, today }: { departments: Dept[]; defaultDept?: string; access: Role[]; today: string }) {
  const t = useTranslations();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [username, setUsername] = useState("");
  const [typedUsername, setTypedUsername] = useState(false);
  const [deptId, setDeptId] = useState(defaultDept ?? (departments.length === 1 ? departments[0].id : ""));
  const dept = departments.find((d) => d.id === deptId);
  const [hourly, setHourly] = useState("");
  const [monthly, setMonthly] = useState("");
  const [hours, setHours] = useState("160");
  const shownUsername = typedUsername ? username : suggestUsername(first, last);

  // "1000 € for 160 h" → 6.25 €/h
  const fromMonthly = (m: string, h: string) => {
    const amount = Number(m.replace(",", "."));
    const hrs = Number(h.replace(",", "."));
    if (amount > 0 && hrs > 0) setHourly((Math.round((amount / hrs) * 100) / 100).toFixed(2));
  };

  return (
    <>
      <div>
        <label className="label" htmlFor="ef-first">{t("common.firstName")}</label>
        <input id="ef-first" name="firstName" className="input" required value={first} onChange={(e) => setFirst(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="ef-last">{t("common.lastName")}</label>
        <input id="ef-last" name="lastName" className="input" required value={last} onChange={(e) => setLast(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="ef-dept">{t("common.department")}</label>
        <select id="ef-dept" name="departmentId" className="input" required value={deptId} onChange={(e) => setDeptId(e.target.value)}>
          <option value="" disabled>{t("common.choose")}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="ef-role">{t("common.position")}</label>
        <select id="ef-role" name="jobRoleId" className="input" defaultValue="" key={`r${deptId}`}>
          <option value="">{dept?.roles.length ? t("setup.noRole") : t("employees.noRolesYet")}</option>
          {dept?.roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="ef-place">{t("setup.usualLocation")}</label>
        <select id="ef-place" name="homeLocationId" className="input" defaultValue="" key={`p${deptId}`}>
          <option value="">{t("setup.noLocation")}</option>
          {dept?.places.map((l) => (
            <option key={l.id} value={l.id}>{l.code} – {l.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="ef-phone">{t("employees.phone")}</label>
        <input id="ef-phone" name="phone" type="tel" className="input" autoComplete="off" />
      </div>
      <div className="sm:col-span-2 lg:col-span-3 rounded-xl bg-gray-50 p-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_1fr]">
          <div>
            <label className="label" htmlFor="ef-rate">{t("employees.hourlyRate")}</label>
            <input id="ef-rate" name="hourlyRate" className="input" inputMode="decimal" placeholder="6.25" required value={hourly} onChange={(e) => setHourly(e.target.value)} />
          </div>
          <div className="self-end pb-2.5 text-center text-sm text-gray-500">{t("employees.or")}</div>
          <div>
            <label className="label" htmlFor="ef-monthly">{t("employees.monthlyPay")}</label>
            <div className="flex items-center gap-1.5">
              <input
                id="ef-monthly"
                className="input"
                inputMode="decimal"
                placeholder="1000"
                value={monthly}
                onChange={(e) => {
                  setMonthly(e.target.value);
                  fromMonthly(e.target.value, hours);
                }}
              />
              <span className="text-sm text-gray-500">/</span>
              <input
                aria-label={t("employees.hoursPerMonth")}
                className="input w-20"
                inputMode="numeric"
                value={hours}
                onChange={(e) => {
                  setHours(e.target.value);
                  fromMonthly(monthly, e.target.value);
                }}
              />
              <span className="text-sm text-gray-500">{t("common.hourUnit")}</span>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="ef-from">{t("employees.rateFrom")}</label>
            <input id="ef-from" name="effectiveFrom" type="date" className="input" defaultValue={today} required />
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">{t("employees.payHelp")}</p>
      </div>
      <div>
        <label className="label" htmlFor="ef-username">{t("employees.usernameOptional")}</label>
        <input
          id="ef-username"
          name="username"
          className="input"
          autoCapitalize="none"
          value={shownUsername}
          onChange={(e) => {
            setTypedUsername(true);
            setUsername(e.target.value);
          }}
        />
      </div>
      <div>
        <label className="label" htmlFor="ef-email">{t("account.emailOptional")}</label>
        <input id="ef-email" name="email" type="email" className="input" autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="ef-access">{t("employees.access")}</label>
        <select id="ef-access" name="role" className="input" defaultValue="employee">
          {access.map((r) => (
            <option key={r} value={r}>{t(`roles.${r}`)}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="ef-no">{t("common.employeeNo")}</label>
        <input id="ef-no" name="employeeNo" className="input" />
      </div>
    </>
  );
}
