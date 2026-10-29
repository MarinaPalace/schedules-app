import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { markIntroSeen } from "@/app/actions/guide";
import { getSetting } from "@/lib/settings";
import type { CurrentUser, Role } from "@/lib/session";
import { ActionButton } from "@/components/action-button";

/** Where each role starts (the first card's button). */
const START: Partial<Record<Role, string>> = {
  top_manager: "/admin/departments",
  manager: "/setup",
  accountant: "/timesheet/month",
  employee: "/me",
};

/**
 * Shown once on the first login (owner/admin get the welcome wizard instead):
 * three short points on what this role does here and where to start.
 */
export async function FirstIntro({ user }: { user: CurrentUser }) {
  if (user.role === "owner" || user.role === "admin") return null;
  if ((await getSetting(`intro_seen:${user.id}`)) === "1") return null;
  const t = await getTranslations("intro");
  const role = user.role;
  return (
    <section className="card space-y-3 border-green-200 bg-green-50" aria-label={t("title")}>
      <h2 className="font-semibold">{t("hello", { name: user.name.split(" ")[0] })}</h2>
      <p className="text-sm text-gray-700">{t(`${role}.lead`)}</p>
      <ul className="space-y-1.5 text-sm">
        {(["one", "two", "three"] as const).map((k) => (
          <li key={k} className="flex gap-2">
            <span className="text-green-700">✓</span>
            <span>{t(`${role}.${k}`)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {START[role] && (
          <Link href={START[role]!} className="btn btn-primary">
            {t(`${role}.start`)}
          </Link>
        )}
        <ActionButton action={markIntroSeen} args={[]} className="btn">
          {t("gotIt")}
        </ActionButton>
        <Link href="/help" className="btn">
          {t("guide")}
        </Link>
      </div>
    </section>
  );
}
