import { and, asc, eq, isNotNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db/client";
import { departments, employees, user } from "@/db/schema";
import { printableLinks } from "@/lib/account-links";
import { loginStatuses } from "@/lib/login-status";
import { emailConfigured, telegramConfigured } from "@/lib/notify/channels";
import { canEditStaffOf, getCurrentUser, staffDepartments } from "@/lib/session";
import { getHotelName } from "@/lib/settings";
import { renderSlipsPdf } from "@/lib/slips-pdf";

/**
 * Printable invite slips for everyone in a department who hasn't signed in yet.
 * Printing makes fresh links (older unused ones stop working), so the paper always works.
 */
export async function GET(request: Request) {
  const me = await getCurrentUser();
  if (!me) return new Response("Unauthorized", { status: 401 });
  // Without ?dept= (or with a bad one) use the first department this person manages.
  const params = new URL(request.url).searchParams;
  const asked = params.get("dept") ?? "";
  // Printing replaces the person's invite link, so by default only people the app can't reach
  // (no email/Telegram) get a slip – an emailed invite keeps working. ?all=1 prints everyone.
  const all = params.get("all") === "1";
  const deptId = z.uuid().safeParse(asked).success ? asked : (await staffDepartments(me))[0]?.id;
  const dept = deptId ? await db.query.departments.findFirst({ where: eq(departments.id, deptId) }) : undefined;
  if (!dept || !(await canEditStaffOf(me, dept.id))) return new Response("Forbidden", { status: 403 });

  const people = await db
    .select({
      first: employees.firstName,
      last: employees.lastName,
      userId: user.id,
      username: user.username,
      role: user.role,
      active: user.active,
      email: user.contactEmail,
      chat: user.telegramChatId,
    })
    .from(employees)
    .innerJoin(user, eq(user.id, employees.userId))
    .where(and(eq(employees.departmentId, dept.id), eq(employees.active, true), isNotNull(employees.userId)))
    .orderBy(asc(employees.lastName), asc(employees.firstName));
  const status = await loginStatuses(people.map((p) => p.userId));
  // Managers print only for staff (access "Employee"); admin/owner/GM for everyone in the department.
  const waiting = people.filter((p) => p.active && status.get(p.userId) !== "active" && (me.role !== "manager" || p.role === "employee"));
  const reachable = (p: (typeof waiting)[number]) => (!!p.email && emailConfigured()) || (!!p.chat && telegramConfigured());
  const todo = all ? waiting : waiting.filter((p) => !reachable(p));
  const t = await getTranslations("slips");
  if (!todo.length) {
    const text = waiting.length ? t("allReached", { count: waiting.length }) : t("none");
    const more = waiting.length ? `<p><a href="?dept=${dept.id}&amp;all=1">${escapeHtml(t("printAll"))}</a></p>` : "";
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:16px"><p>${escapeHtml(text)}</p>${more}`, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }

  const slips = [];
  for (const p of todo) slips.push({ name: `${p.first} ${p.last}`, username: p.username ?? "", ...(await printableLinks(me.id, p.userId)) });
  const pdf = await renderSlipsPdf(slips, {
    hotel: `${(await getHotelName()) ?? t("app")} · ${dept.name}`,
    scan: t("scan"),
    username: t("username"),
    telegram: t("telegram"),
    valid: t("valid"),
    steps: t("steps"),
  });
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="invites.pdf"`, "Cache-Control": "private, no-store" },
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
