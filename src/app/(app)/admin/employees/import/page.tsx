import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser, staffDepartments, STAFF_EDITORS } from "@/lib/session";
import { PageHelp } from "@/components/page-help";
import { StaffImport } from "@/components/staff-import";

/** Paste staff from Excel: preview, then create everyone (with logins and invites) at once. */
export default async function ImportPage({ searchParams }: PageProps<"/admin/employees/import">) {
  const me = await requireUser(STAFF_EDITORS);
  const t = await getTranslations();
  const deps = await staffDepartments(me);
  const { dept } = (await searchParams) as { dept?: string };
  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <Link href="/admin/employees" className="text-sm text-blue-700 hover:underline">{t("employees.back")}</Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="page-title">{t("import.title")}</h1>
          <PageHelp text={t("help.import")} />
        </div>
        <p className="text-sm text-gray-500">{t("import.help")}</p>
      </div>
      <StaffImport departments={deps.map(({ id, name }) => ({ id, name }))} defaultDept={deps.some((d) => d.id === dept) ? dept! : null} />
    </div>
  );
}
