"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { user } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/app-error";
import { assertRole, assignableRoles, ROLES, type Role } from "@/lib/session";
import { db } from "@/db/client";
import { createLogin, randomPassword } from "@/lib/users";
import { sendPasswordLink } from "@/lib/account-links";
import { errorMessage } from "@/lib/errors";
import type { LinkResult } from "@/lib/link-result";

const nameSchema = z.string().trim().min(2, "nameTooShort");

/** New login (e.g. a manager or accountant without an employee record); they get a link to choose a password. */
export async function createUser(_: LinkResult, form: FormData): Promise<LinkResult> {
  try {
    const me = await assertRole(["admin", "owner"]);
    const role = z.enum(ROLES).parse(form.get("role"));
    if (!assignableRoles(me).includes(role)) throw new AppError("notAllowed");
    const name = nameSchema.parse(form.get("name"));
    const email = String(form.get("email") ?? "").trim();
    const contactEmail = email ? z.email("emailFormat").parse(email) : null;
    const userId = await withActor(me.id, (tx) =>
      createLogin(tx, { username: String(form.get("username") ?? ""), password: randomPassword(), name, role, contactEmail }),
    );
    revalidatePath("/admin/users");
    return { ok: (await getTranslations("users"))("created", { name }), ...(await sendPasswordLink(me.id, userId, "setup")), at: Date.now() };
  } catch (e) {
    return { error: await errorMessage(e), at: Date.now() };
  }
}

export async function updateUser(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(["admin", "owner"]);
    const id = z.string().min(1).parse(form.get("id"));
    const role = z.enum(ROLES).parse(form.get("role"));
    const target = await db.query.user.findFirst({ where: eq(user.id, id) });
    if (!target) throw new AppError("userNotFound");
    if (!assignableRoles(me).includes(role) || !assignableRoles(me).includes(target.role as Role)) throw new AppError("notAllowed");
    const name = nameSchema.parse(form.get("name"));
    const active = form.get("active") === "on";
    if (id === me.id && (role !== me.role || !active)) throw new AppError("ownAdmin");
    await withActor(me.id, (tx) => tx.update(user).set({ role, name, active, updatedAt: new Date() }).where(eq(user.id, id)));
    revalidatePath("/admin/users");
  });
}
