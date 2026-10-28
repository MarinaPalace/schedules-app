import { getTranslations } from "next-intl/server";
import { requireUser, type Role } from "@/lib/session";
import { signOut } from "@/app/actions/auth";
import { Nav } from "@/components/nav";
import { LanguageSwitcher } from "@/components/language-switcher";

type NavKey = "dashboard" | "schedule" | "forma76" | "corrections" | "advances" | "mySchedule" | "budgets" | "departments" | "employees" | "shifts" | "users" | "audit";

const NAV: Array<{ href: string; key: NavKey; admin?: boolean; roles: Role[] }> = [
  { href: "/dashboard", key: "dashboard", roles: ["manager", "top_manager", "owner", "accountant", "admin"] },
  { href: "/schedule", key: "schedule", roles: ["manager", "top_manager", "owner", "accountant", "admin"] },
  { href: "/timesheet", key: "forma76", roles: ["manager", "top_manager", "owner", "accountant", "admin"] },
  { href: "/corrections", key: "corrections", roles: ["manager", "top_manager", "owner", "admin"] },
  { href: "/advances", key: "advances", roles: ["manager", "top_manager", "owner", "accountant", "admin"] },
  { href: "/me", key: "mySchedule", roles: ["employee", "manager", "top_manager", "admin"] },
  { href: "/admin/budgets", key: "budgets", admin: true, roles: ["owner", "admin", "top_manager"] },
  { href: "/admin/departments", key: "departments", admin: true, roles: ["admin", "top_manager"] },
  { href: "/admin/employees", key: "employees", admin: true, roles: ["admin", "top_manager"] },
  { href: "/admin/shifts", key: "shifts", admin: true, roles: ["admin", "top_manager"] },
  { href: "/admin/users", key: "users", admin: true, roles: ["admin"] },
  { href: "/admin/audit", key: "audit", admin: true, roles: ["admin", "owner"] },
];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const t = await getTranslations();
  const items = NAV.filter((n) => n.roles.includes(user.role)).map((n) => ({
    href: n.href,
    label: t(`nav.${n.key}`),
    section: n.admin ? t("nav.adminSection") : undefined,
  }));

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="border-b border-gray-200 bg-white p-3 md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="mb-2 flex items-center justify-between md:mb-4 md:block">
          <div className="px-3">
            <div className="text-sm font-semibold">{t("common.appName")}</div>
            <div className="text-xs text-gray-500">
              {user.name} · {t(`roles.${user.role}`)}
            </div>
          </div>
          <div className="flex items-center gap-2 md:hidden">
            <LanguageSwitcher />
            <form action={signOut}>
              <button className="btn btn-sm">{t("common.signOut")}</button>
            </form>
          </div>
        </div>
        <Nav items={items} />
        <div className="mt-6 hidden space-y-3 px-3 md:block">
          <LanguageSwitcher />
          <form action={signOut}>
            <button className="text-sm text-gray-500 hover:text-gray-800">{t("common.signOut")}</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
