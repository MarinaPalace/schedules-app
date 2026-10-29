import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { href } from "@/lib/href";
import { loadPlans, loadSeasons } from "@/lib/needs";
import { loadLocations, loadRoles } from "@/lib/org";
import { getVisibleDepartments, requireUser } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";
import { NeedsEditor } from "@/components/needs-editor";
import { PageHelp } from "@/components/page-help";
import { LinkTabs } from "@/components/toolbar";

/** How many people of each role every location needs, by time of day – per weekdays, season or date. */
export default async function NeedsPage({ searchParams }: PageProps<"/needs">) {
  const me = await requireUser(["manager", "top_manager", "owner", "admin"]);
  const t = await getTranslations();
  const deps = await getVisibleDepartments(me);
  if (!deps.length) return <p className="text-sm text-gray-500">{t("common.noDepartments")}</p>;
  const sp = (await searchParams) as { dept?: string; location?: string };
  const dept = deps.find((d) => d.id === sp.dept) ?? deps[0];
  const [places, roles, seasons] = await Promise.all([loadLocations([dept.id]), loadRoles([dept.id]), loadSeasons()]);
  const place = places.find((l) => l.id === sp.location) ?? places[0];
  const plans = place ? await loadPlans([place.id]) : [];

  return (
    <div className="max-w-5xl space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="page-title">{t("needs.title")}</h1>
          <PageHelp text={t("help.needs")} />
        </div>
        <p className="text-sm text-gray-500">{t("needs.help")}</p>
        {deps.length > 1 && <LinkTabs base="/needs" params={{}} name="dept" value={dept.id} options={deps.map((d) => ({ value: d.id, label: d.name }))} />}
      </div>

      {!places.length || !roles.length ? (
        <EmptyState
          icon="dashboard"
          title={t("needs.firstTitle")}
          text={t(!places.length ? "needs.noLocations" : "needs.noRoles")}
          action={{ href: href("/setup", { dept: dept.id }), label: t("nav.setup") }}
        />
      ) : (
        <>
          <LinkTabs base="/needs" params={{ dept: dept.id }} name="location" value={place.id} options={places.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))} />
          <NeedsEditor
            key={place.id}
            location={{ id: place.id, code: place.code, name: place.name }}
            otherLocations={places.filter((l) => l.id !== place.id).map(({ id, code, name }) => ({ id, code, name }))}
            roles={roles.map(({ id, name }) => ({ id, name }))}
            seasons={seasons.filter((s) => s.active)}
            plans={plans}
          />
          <p className="text-xs text-gray-500">
            {t("needs.rulesNote")}{" "}
            <Link href="/admin/hotel#seasons" className="text-blue-700 hover:underline">
              {t("needs.seasonsLink")}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
