"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { user } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/app-error";
import { assertRole, ROLES } from "@/lib/session";
import { createLogin } from "@/lib/users";

const nameSchema = z.string().trim().min(2, "nameTooShort");

export async function createUser(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(["admin"]);
    const role = z.enum(ROLES).parse(form.get("role"));
    const name = nameSchema.parse(form.get("name"));
    await withActor(me.id, (tx) =>
      createLogin(tx, { username: String(form.get("username") ?? ""), password: String(form.get("password") ?? ""), name, role }),
    );
    revalidatePath("/admin/users");
    return (await getTranslations("users"))("created", { name });
  });
}

export async function updateUser(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(["admin"]);
    const id = z.string().min(1).parse(form.get("id"));
    const role = z.enum(ROLES).parse(form.get("role"));
    const name = nameSchema.parse(form.get("name"));
    const active = form.get("active") === "on";
    if (id === me.id && (role !== "admin" || !active)) throw new AppError("ownAdmin");
    await withActor(me.id, (tx) => tx.update(user).set({ role, name, active, updatedAt: new Date() }).where(eq(user.id, id)));
    revalidatePath("/admin/users");
  });
}
