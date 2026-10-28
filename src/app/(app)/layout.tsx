import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { requireUser, type Role } from "@/lib/session";
import { signOut } from "@/app/actions/auth";
import { Nav } from "@/components/nav";
import { MobileNav } from "@/components/mobile-nav";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher, type Theme } from "@/components/theme-switcher";

type NavKey =
  | "dashboard"
  | "schedule"
  | "forma76"
  | "team"
  | "corrections"
  | "advances"
  | "mySchedule"
  | "budgets"
  | "departments"
  | "employees"
  | "shifts"
  | "users"
  | "audit";

const NAV: Array<{ href: string; key: NavKey; icon: string; admin?: boolean; roles: Role[] }> = [
  { href: "/dashboard", key: "dashboard", icon: "dashboard", roles: ["manager", "top_manager", "owner", "accountant", "admin"] },
  { href: "/schedule", key: "schedule", icon: "schedule", roles: ["manager", "top_manager", "owner", "accountant", "admin"] },
  { href: "/timesheet", key: "forma76", icon: "forma76", roles: ["manager", "top_manager", "owner", "accountant", "admin"] },
  { href: "/team", key: "team", icon: "team", roles: ["manager", "top_manager", "owner", "admin"] },
  { href: "/corrections", key: "corrections", icon: "corrections", roles: ["manager", "top_manager", "owner", "admin"] },
  { href: "/advances", key: "advances", icon: "advances", roles: ["manager", "top_manager", "owner", "accountant", "admin"] },
  { href: "/me", key: "mySchedule", icon: "mySchedule", roles: ["employee", "manager", "top_manager", "admin"] },
  { href: "/admin/budgets", key: "budgets", icon: "budgets", admin: true, roles: ["owner", "admin", "top_manager"] },
  { href: "/admin/departments", key: "departments", icon: "admin", admin: true, roles: ["admin", "owner", "top_manager"] },
  { href: "/admin/employees", key: "employees", icon: "team", admin: true, roles: ["admin", "owner", "top_manager"] },
  { href: "/admin/shifts", key: "shifts", icon: "schedule", admin: true, roles: ["admin", "owner", "top_manager"] },
  { href: "/admin/users", key: "users", icon: "admin", admin: true, roles: ["admin", "owner"] },
  { href: "/admin/audit", key: "audit", icon: "forma76", admin: true, roles: ["admin", "owner"] },
];

/** What sits in the phone's bottom bar for each role (the rest is under "Menu"). */
const PRIMARY: Record<Role, NavKey[]> = {
  employee: ["mySchedule"],
  manager: ["schedule", "forma76", "team", "mySchedule"],
  top_manager: ["dashboard", "schedule", "forma76", "team"],
  admin: ["dashboard", "schedule", "forma76", "team"],
  owner: ["dashboard", "schedule", "team", "budgets"],
  accountant: ["dashboard", "forma76", "advances"],
};

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const t = await getTranslations();
  const savedTheme = (await cookies()).get("theme")?.value;
  const theme: Theme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : "system";

  const visible = NAV.filter((n) => n.roles.includes(user.role));
  const items = visible.map((n) => ({
    href: n.href,
    label: t(`nav.${n.key}`),
    icon: n.icon,
    section: n.admin ? t("nav.adminSection") : undefined,
  }));
  const primary = PRIMARY[user.role].map((key) => items[visible.findIndex((n) => n.key === key)]).filter(Boolean);
  const userLine = `${user.name} · ${t(`roles.${user.role}`)}`;

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      {/* Phone: slim top bar + bottom tabs */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-surface/95 px-4 py-2.5 backdrop-blur md:hidden">
        <div className="text-sm font-semibold">{t("common.appName")}</div>
        <div className="truncate pl-3 text-xs text-gray-500">{userLine}</div>
      </header>
      <MobileNav primary={primary} all={items} theme={theme} signOut={signOut} userLine={userLine} />

      {/* Tablet / computer: sidebar */}
      <aside className="hidden border-r border-gray-200 bg-surface p-3 md:flex md:w-60 md:shrink-0 md:flex-col">
        <div className="mb-4 px-3">
          <div className="text-sm font-semibold">{t("common.appName")}</div>
          <div className="text-xs text-gray-500">{userLine}</div>
        </div>
        <Nav items={items} />
        <div className="mt-6 space-y-3 px-3">
          <LanguageSwitcher />
          <ThemeSwitcher initial={theme} />
          <form action={signOut}>
            <button className="text-sm text-gray-500 hover:text-gray-800">{t("common.signOut")}</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 pb-28 sm:p-6 md:pb-6">{children}</main>
    </div>
  );
}
