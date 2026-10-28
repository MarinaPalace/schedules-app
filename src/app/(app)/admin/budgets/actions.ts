"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { budgets, departments, settings } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/app-error";
import { addMonths, isMonth } from "@/lib/calendar";
import { loadBudgets } from "@/lib/data";
import { parseEurToCents } from "@/lib/money";
import { assertRole } from "@/lib/session";

const BUDGET_ROLES = ["owner", "admin", "top_manager"] as const;

/** Saves budgets for all departments in the form; only changed values create new rows. */
export async function saveBudgets(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(BUDGET_ROLES);
    const t = await getTranslations("budgets");
    const month = String(form.get("month"));
    if (!isMonth(month)) throw new AppError("invalidMonth");
    const deps = await withActor(me.id, (tx) => tx.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.active, true)));
    const current = await loadBudgets(deps.map((d) => d.id), month);

    const rows: (typeof budgets.$inferInsert)[] = [];
    for (const d of deps) {
      const amountRaw = String(form.get(`amount_${d.id}`) ?? "").trim();
      const hoursRaw = String(form.get(`hours_${d.id}`) ?? "").trim();
      if (!amountRaw) continue;
      const amountCents = parseEurToCents(amountRaw);
      if (amountCents === null) throw new AppError("invalidAmount", { name: d.name, value: amountRaw });
      const hours = hoursRaw ? Number(hoursRaw) : null;
      if (hours !== null && (!Number.isInteger(hours) || hours < 0)) throw new AppError("hoursWhole", { name: d.name });
      const cur = current.get(d.id);
      if (cur && cur.amountCents === amountCents && cur.hours === hours) continue;
      rows.push({ departmentId: d.id, month: `${month}-01`, amountCents, hours, createdBy: me.id });
    }
    if (!rows.length) return t("noChanges");
    await withActor(me.id, (tx) => tx.insert(budgets).values(rows));
    revalidatePath("/admin/budgets");
    revalidatePath("/dashboard");
    return t("savedCount", { count: rows.length });
  });
}

export async function copyBudgetsFromPreviousMonth(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(BUDGET_ROLES);
    const t = await getTranslations("budgets");
    const month = String(form.get("month"));
    if (!isMonth(month)) throw new AppError("invalidMonth");
    const deps = await withActor(me.id, (tx) => tx.select({ id: departments.id }).from(departments).where(eq(departments.active, true)));
    const ids = deps.map((d) => d.id);
    const [prev, cur] = await Promise.all([loadBudgets(ids, addMonths(month, -1)), loadBudgets(ids, month)]);
    const rows = [...prev.values()]
      .filter((p) => !cur.has(p.departmentId))
      .map((p) => ({ departmentId: p.departmentId, month: `${month}-01`, amountCents: p.amountCents, hours: p.hours, createdBy: me.id }));
    if (!rows.length) return t("nothingToCopy");
    await withActor(me.id, (tx) => tx.insert(budgets).values(rows));
    revalidatePath("/admin/budgets");
    revalidatePath("/dashboard");
    return t("copiedCount", { count: rows.length });
  });
}

export async function saveCostFactor(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(["owner", "admin"]);
    const factor = z.coerce.number().min(1, "factorMin").max(3, "factorMax").parse(String(form.get("factor")).replace(",", "."));
    await withActor(me.id, (tx) =>
      tx
        .insert(settings)
        .values({ key: "employer_cost_factor", value: String(factor) })
        .onConflictDoUpdate({ target: settings.key, set: { value: String(factor) } }),
    );
    revalidatePath("/", "layout");
    return (await getTranslations("budgets"))("factorSet", { factor });
  });
}
