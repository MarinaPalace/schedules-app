import type { getTranslations } from "next-intl/server";

type T = Awaited<ReturnType<typeof getTranslations<never>>>;

/** Pending → approved → given, or rejected. */
export function AdvanceBadge({ a, t }: { a: { decision: string | null; givenAt: Date | null }; t: T }) {
  if (a.givenAt) return <span className="badge self-start bg-green-100 text-green-800">✓ {t("advances.given")}</span>;
  if (a.decision === "approved") return <span className="badge self-start bg-blue-50 text-blue-700">{t("decision.approved")}</span>;
  if (a.decision === "rejected") return <span className="badge self-start bg-red-100 text-red-800">{t("decision.rejected")}</span>;
  return <span className="badge self-start bg-amber-100 text-amber-800">{t("common.pending")}</span>;
}
