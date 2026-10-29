"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { seasons } from "@/db/schema";
import { LOCALES } from "@/i18n/config";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/app-error";
import { assertRole } from "@/lib/session";
import { setSetting } from "@/lib/settings";

const factorSchema = z.coerce.number().min(1, "factorMin").max(3, "factorMax");

/** Hotel name, language for new accounts and the cost factor (only used for total-cost budgets). */
export async function saveHotelProfile(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(["owner", "admin"]);
    const name = z.string().trim().min(2, "nameTooShort").max(80).parse(form.get("hotelName"));
    const locale = z.enum(LOCALES).parse(form.get("defaultLocale"));
    const factor = factorSchema.parse(String(form.get("factor") ?? "").replace(",", "."));
    await withActor(me.id, async (tx) => {
      await setSetting(tx, "hotel_name", name);
      await setSetting(tx, "default_locale", locale);
      await setSetting(tx, "employer_cost_factor", String(factor));
    });
    revalidatePath("/", "layout");
    return (await getTranslations("hotel"))("saved");
  });
}

const seasonFields = z
  .object({
    name: z.string().trim().min(1, "nameTooShort").max(60),
    fromDate: z.iso.date("dateRequired"),
    toDate: z.iso.date("dateRequired"),
  })
  .refine((v) => v.fromDate <= v.toDate, "invalidPeriod");

/** Seasons are hotel-wide; owner and GM set them (staffing needs can differ per season). */
export async function createSeason(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(["owner", "admin", "top_manager"]);
    const data = seasonFields.parse(Object.fromEntries(form));
    await withActor(me.id, (tx) => tx.insert(seasons).values({ ...data, createdBy: me.id }));
    revalidatePath("/admin/hotel");
    revalidatePath("/needs");
  });
}

export async function updateSeason(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(["owner", "admin", "top_manager"]);
    const id = z.uuid().parse(form.get("id"));
    const data = seasonFields.parse(Object.fromEntries(form));
    const found = await withActor(me.id, (tx) =>
      tx
        .update(seasons)
        .set({ ...data, active: form.get("active") === "on" })
        .where(eq(seasons.id, id))
        .returning({ id: seasons.id }),
    );
    if (!found.length) throw new AppError("invalid");
    revalidatePath("/admin/hotel");
    revalidatePath("/needs");
  });
}
