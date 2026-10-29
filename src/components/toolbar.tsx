import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { href } from "@/lib/href";

type Option = { value: string; label: string };

/** Row of link-buttons; keeps the other query params. */
export function LinkTabs({
  base,
  params,
  name,
  value,
  options,
}: {
  base: string;
  params: Record<string, string | undefined>;
  name: string;
  value: string;
  options: Option[];
}) {
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-gray-300 bg-surface text-sm">
      {options.map((o) => (
        <Link
          key={o.value}
          href={href(base, { ...params, [name]: o.value })}
          className={`px-3 py-1.5 ${o.value === value ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-50"}`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

export async function PeriodNav({ label, prev, next, today }: { label: string; prev: string; next: string; today?: string }) {
  const t = await getTranslations("common");
  return (
    <div className="inline-flex items-center gap-1">
      <Link href={prev} className="btn btn-sm" aria-label={t("previous")}>←</Link>
      <span className="min-w-36 text-center text-sm font-medium">{label}</span>
      <Link href={next} className="btn btn-sm" aria-label={t("next")}>→</Link>
      {today && (
        <Link href={today} className="btn btn-sm">
          {t("today")}
        </Link>
      )}
    </div>
  );
}

export { href } from "@/lib/href";
