import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/session";

const ROLES = ["owner", "top_manager", "manager", "accountant", "employee"] as const;
const FAQ = ["publish", "swap", "forma", "advance", "pdf", "password"] as const;
const FLOW = ["owner", "departments", "manager", "staff", "schedule", "daily"] as const;

/** The guide: how the app fits together, what each role does, common questions. */
export default async function HelpPage() {
  const me = await requireUser();
  const t = await getTranslations("guide");
  const mine: (typeof ROLES)[number] = me.role === "admin" ? "owner" : (me.role as (typeof ROLES)[number]);
  const order = [mine, ...ROLES.filter((r) => r !== mine)];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="page-title">{t("title")}</h1>
        <p className="text-sm text-gray-500">{t("lead")}</p>
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold">{t("flowTitle")}</h2>
        <ol className="relative space-y-3 border-l-2 border-blue-200 pl-5">
          {FLOW.map((k, i) => (
            <li key={k} className="relative">
              <span className="absolute top-0 -left-[31px] flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{i + 1}</span>
              <div className="font-medium">{t(`flow.${k}.title`)}</div>
              <div className="text-sm text-gray-600">{t(`flow.${k}.text`)}</div>
            </li>
          ))}
        </ol>
        {(me.role === "owner" || me.role === "admin") && (
          <Link href="/welcome" className="btn btn-sm">
            {t("reopenWelcome")}
          </Link>
        )}
      </section>

      {order.map((r) => (
        <section key={r} className={`card space-y-2 ${r === mine ? "border-blue-300" : ""}`} id={r}>
          <h2 className="font-semibold">
            {t(`role.${r}.title`)}
            {r === mine && <span className="badge ml-2 bg-blue-50 text-blue-700">{t("you")}</span>}
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
            {(["one", "two", "three", "four"] as const).map((k) => (
              <li key={k}>{t(`role.${r}.${k}`)}</li>
            ))}
          </ul>
        </section>
      ))}

      <section className="card space-y-2">
        <h2 className="font-semibold">{t("faqTitle")}</h2>
        {FAQ.map((k) => (
          <details key={k} className="rounded-lg border border-gray-100 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">{t(`faq.${k}.q`)}</summary>
            <p className="mt-1 text-sm text-gray-600">{t(`faq.${k}.a`)}</p>
          </details>
        ))}
      </section>
    </div>
  );
}

