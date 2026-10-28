import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { departments } from "@/db/schema";
import { addMonths, isMonth, monthLabel, monthOf } from "@/lib/calendar";
import { getCostFactor, loadBudgets } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { requireUser } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PeriodNav, href } from "@/components/toolbar";
import { copyBudgetsFromPreviousMonth, saveBudgets, saveCostFactor } from "./actions";
import { getLocale, getTranslations } from "next-intl/server";

export default async function BudgetsPage({ searchParams }: PageProps<"/admin/budgets">) {
  const me = await requireUser(["owner", "admin", "top_manager"]);
  const t = await getTranslations();
  const locale = await getLocale();
  const sp = (await searchParams) as { month?: string };
  const month = isMonth(sp.month) ? sp.month : monthOf(todayISO());
  const deps = await db.select().from(departments).where(eq(departments.active, true)).orderBy(asc(departments.name));
  const [current, factor] = await Promise.all([loadBudgets(deps.map((d) => d.id), month), getCostFactor()]);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title mr-2">{t("budgets.title")}</h1>
        <PeriodNav
          label={monthLabel(month, locale)}
          prev={href("/admin/budgets", { month: addMonths(month, -1) })}
          next={href("/admin/budgets", { month: addMonths(month, 1) })}
        />
      </div>

      <div className="card">
        <ActionForm action={saveBudgets} className="space-y-3">
          <input type="hidden" name="month" value={month} />
          <table className="table">
            <thead>
              <tr>
                <th>{t("common.department")}</th>
                <th>{t("budgets.amount")}</th>
                <th>{t("budgets.hoursOptional")}</th>
              </tr>
            </thead>
            <tbody>
              {deps.map((d) => {
                const b = current.get(d.id);
                return (
                  <tr key={d.id}>
                    <td className="font-medium">{d.name}</td>
                    <td>
                      <input name={`amount_${d.id}`} defaultValue={b ? (b.amountCents / 100).toFixed(2) : ""} className="input w-36" inputMode="decimal" placeholder="0.00" />
                    </td>
                    <td>
                      <input name={`hours_${d.id}`} defaultValue={b?.hours ?? ""} className="input w-24" inputMode="numeric" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <SubmitButton>{t("budgets.saveFor", { month: monthLabel(month, locale) })}</SubmitButton>
        </ActionForm>
        <ActionForm action={copyBudgetsFromPreviousMonth} className="mt-3">
          <input type="hidden" name="month" value={month} />
          <SubmitButton className="btn btn-sm">{t("budgets.copyFrom", { month: monthLabel(addMonths(month, -1), locale) })}</SubmitButton>
        </ActionForm>
        <p className="mt-3 text-xs text-gray-500">{t("budgets.historyNote")}</p>
      </div>

      {(me.role === "owner" || me.role === "admin") && (
        <div className="card">
          <h2 className="mb-1 font-medium">{t("budgets.factorTitle")}</h2>
          <p className="mb-3 text-sm text-gray-500">
            {t("budgets.factorHelp")}
          </p>
          <ActionForm action={saveCostFactor} className="flex items-end gap-2">
            <div>
              <label className="label">{t("budgets.factor")}</label>
              <input name="factor" defaultValue={factor} className="input w-24" inputMode="decimal" />
            </div>
            <SubmitButton className="btn">{t("common.save")}</SubmitButton>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
