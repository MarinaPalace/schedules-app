"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/** Hourly pay, or a monthly amount for a number of hours that is turned into the hourly pay ("1000 € for 160 h" → 6.25). */
export function PayInput({ name = "hourlyRate", required = true }: { name?: string; required?: boolean }) {
  const t = useTranslations();
  const [hourly, setHourly] = useState("");
  const [monthly, setMonthly] = useState("");
  const [hours, setHours] = useState("160");
  const fromMonthly = (m: string, h: string) => {
    const amount = Number(m.replace(",", "."));
    const hrs = Number(h.replace(",", "."));
    if (amount > 0 && hrs > 0) setHourly((Math.round((amount / hrs) * 100) / 100).toFixed(2));
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="label" htmlFor={`${name}-h`}>{t("employees.hourlyRate")}</label>
        <input id={`${name}-h`} name={name} className="input w-28" inputMode="decimal" placeholder="6.25" required={required} value={hourly} onChange={(e) => setHourly(e.target.value)} />
      </div>
      <span className="pb-2.5 text-sm text-gray-500">{t("employees.or")}</span>
      <div>
        <label className="label" htmlFor={`${name}-m`}>{t("employees.monthlyPay")}</label>
        <div className="flex items-center gap-1.5">
          <input
            id={`${name}-m`}
            className="input w-28"
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
    </div>
  );
}
