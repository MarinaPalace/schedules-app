import { asc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { LOCALES, LOCALE_LABELS } from "@/i18n/config";
import { getCostFactor } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { requireUser } from "@/lib/session";
import { getDefaultLocale, getHotelName } from "@/lib/settings";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PageHelp } from "@/components/page-help";
import { createSeason, saveHotelProfile, updateSeason } from "./actions";

/** Owner: the hotel's name, language for new accounts, cost factor; owner/GM: seasons. */
export default async function HotelPage() {
  const me = await requireUser(["owner", "admin", "top_manager"]);
  const t = await getTranslations();
  const [name, locale, factor, rows] = await Promise.all([getHotelName(), getDefaultLocale(), getCostFactor(), db.select().from(seasons).orderBy(asc(seasons.fromDate))]);
  const owner = me.role === "owner" || me.role === "admin";

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="page-title">{t("hotel.title")}</h1>
        <PageHelp text={t("help.hotel")} />
      </div>

      {owner && (
        <section className="card space-y-4">
          <h2 className="font-medium">{t("hotel.profile")}</h2>
          <ActionForm action={saveHotelProfile} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="hotelName">
                {t("hotel.name")}
              </label>
              <input id="hotelName" name="hotelName" defaultValue={name ?? ""} className="input" placeholder={t("hotel.namePlaceholder")} required />
            </div>
            <div>
              <label className="label" htmlFor="defaultLocale">
                {t("hotel.language")}
              </label>
              <select id="defaultLocale" name="defaultLocale" defaultValue={locale} className="input">
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_LABELS[l]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">{t("hotel.languageHelp")}</p>
            </div>
            <div>
              <label className="label" htmlFor="factor">
                {t("hotel.factor")}
              </label>
              <input id="factor" name="factor" defaultValue={factor} className="input w-28" inputMode="decimal" />
              <p className="mt-1 text-xs text-gray-500">{t("hotel.factorHelp")}</p>
            </div>
            <div className="sm:col-span-2">
              <SubmitButton>{t("common.save")}</SubmitButton>
            </div>
          </ActionForm>
        </section>
      )}

      <section className="card space-y-3" id="seasons">
        <h2 className="font-medium">{t("hotel.seasons")}</h2>
        <p className="text-sm text-gray-500">{t("hotel.seasonsHelp")}</p>
        {rows.map((s) => (
          <ActionForm key={s.id} action={updateSeason} className={`flex flex-wrap items-end gap-2 ${s.active ? "" : "opacity-60"}`}>
            <input type="hidden" name="id" value={s.id} />
            <input name="name" defaultValue={s.name} className="input min-w-32 flex-1" aria-label={t("common.name")} required />
            <input name="fromDate" type="date" defaultValue={s.fromDate} className="input w-auto" aria-label={t("hotel.from")} required />
            <input name="toDate" type="date" defaultValue={s.toDate} className="input w-auto" aria-label={t("hotel.to")} required />
            <label className="flex min-h-11 items-center gap-1.5 text-sm">
              <input type="checkbox" name="active" defaultChecked={s.active} /> {t("common.active")}
            </label>
            <SubmitButton className="btn btn-sm">{t("common.save")}</SubmitButton>
            <span className="w-full text-xs text-gray-500">
              {formatDate(s.fromDate)} – {formatDate(s.toDate)}
            </span>
          </ActionForm>
        ))}
        <ActionForm action={createSeason} resetOnSuccess className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
          <div className="min-w-32 flex-1">
            <label className="label">{t("hotel.newSeason")}</label>
            <input name="name" className="input" placeholder={t("hotel.seasonPlaceholder")} required />
          </div>
          <div>
            <label className="label">{t("hotel.from")}</label>
            <input name="fromDate" type="date" className="input" required />
          </div>
          <div>
            <label className="label">{t("hotel.to")}</label>
            <input name="toDate" type="date" className="input" required />
          </div>
          <SubmitButton className="btn">{t("common.add")}</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
