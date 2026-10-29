import { getLocale, getTranslations } from "next-intl/server";
import { loadShiftTemplates } from "@/lib/data";
import { getDayLabels } from "@/lib/day-labels";
import { getVisibleDepartments, requireUser } from "@/lib/session";
import { isOpen } from "@/lib/swap-state";
import { loadSwaps } from "@/lib/swaps";
import { DecisionButtons } from "@/components/decision-buttons";
import { SwapCard, SwapLine } from "@/components/swap-card";
import { decideSwap } from "./actions";

export default async function SwapsPage() {
  const me = await requireUser(["manager", "top_manager", "admin", "owner"]);
  const [t, locale, labels] = await Promise.all([getTranslations(), getLocale(), getDayLabels()]);
  const deps = await getVisibleDepartments(me);
  if (!deps.length) return <p className="text-sm text-gray-500">{t("common.noDepartments")}</p>;
  const canDecide = me.role !== "owner";

  const [swaps, templates] = await Promise.all([loadSwaps({ departmentIds: deps.map((d) => d.id) }), loadShiftTemplates()]);
  const forMe = swaps.filter((s) => s.status === "waiting_manager").reverse();
  const withColleague = swaps.filter((s) => s.status === "waiting_colleague");
  const recent = swaps.filter((s) => !isOpen(s.status)).slice(0, 30);
  const card = (s: (typeof swaps)[number], actions?: React.ReactNode) => (
    <SwapCard key={s.id} s={s} templates={templates} labels={labels} t={t} locale={locale} actions={actions} />
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="page-title">{t("swaps.title")}</h1>
        <p className="text-sm text-gray-500">{t("swaps.managerHelp")}</p>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">{t("swaps.waitingYou", { count: forMe.length })}</h2>
        {forMe.length === 0 && <p className="text-sm text-gray-500">{t("swaps.nothing")}</p>}
        {forMe.map((s) =>
          card(
            s,
            canDecide && s.requester.userId !== me.id && s.colleague.userId !== me.id ? (
              <DecisionButtons requestId={s.id} decide={decideSwap} />
            ) : canDecide ? (
              <p className="text-xs text-gray-500">{t("swaps.ownNeedsOther")}</p>
            ) : null,
          ),
        )}
      </section>

      {withColleague.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-medium">{t("swaps.waitingColleague", { count: withColleague.length })}</h2>
          {withColleague.map((s) => card(s))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-medium">{t("swaps.recent")}</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-500">{t("swaps.noneYet")}</p>
        ) : (
          <ul className="card divide-y divide-gray-100 p-0 sm:p-0">
            {recent.map((s) => (
              <SwapLine key={s.id} s={s} t={t} locale={locale} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
