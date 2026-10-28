import { requireUser, ROLE_LABELS, type Role } from "@/lib/session";
import { signOut } from "@/app/actions/auth";
import { Nav, type NavItem } from "@/components/nav";

const NAV: Array<NavItem & { roles: Role[] }> = [
  { href: "/dashboard", label: "Dashboard", roles: ["manager", "top_manager", "owner", "accountant", "admin"] },
  { href: "/me", label: "My schedule", roles: ["employee", "manager", "top_manager", "admin"] },
  { href: "/admin/departments", label: "Departments", section: "Admin", roles: ["admin", "top_manager"] },
  { href: "/admin/employees", label: "Employees", section: "Admin", roles: ["admin", "top_manager"] },
  { href: "/admin/shifts", label: "Shift legends", section: "Admin", roles: ["admin", "top_manager"] },
  { href: "/admin/users", label: "Users & roles", section: "Admin", roles: ["admin"] },
  { href: "/admin/audit", label: "Audit log", section: "Admin", roles: ["admin", "owner"] },
];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const items = NAV.filter((n) => n.roles.includes(user.role)).map(({ href, label, section }) => ({ href, label, section }));

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="border-b border-gray-200 bg-white p-3 md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="mb-2 flex items-center justify-between md:mb-4 md:block">
          <div className="px-3">
            <div className="text-sm font-semibold">Hotel Schedules</div>
            <div className="text-xs text-gray-500">
              {user.name} · {ROLE_LABELS[user.role]}
            </div>
          </div>
          <form action={signOut} className="md:hidden">
            <button className="btn btn-sm">Sign out</button>
          </form>
        </div>
        <Nav items={items} />
        <form action={signOut} className="mt-6 hidden px-3 md:block">
          <button className="text-sm text-gray-500 hover:text-gray-800">Sign out</button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
