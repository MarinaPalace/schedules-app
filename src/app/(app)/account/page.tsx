import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { emailConfigured, telegramBot, telegramConfigured } from "@/lib/notify/channels";
import { requireUser, type Role } from "@/lib/session";
import { PASSWORD_MIN } from "@/lib/users";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ActionButton } from "@/components/action-button";
import { ChangePasswordForm } from "@/components/password-forms";
import { TelegramConnect } from "@/components/telegram-connect";
import { disconnectMyTelegram, sendMeTest, updateMyNotifications } from "./actions";

export default async function AccountPage() {
  const me = await requireUser();
  const t = await getTranslations();
  const u = (await db.query.user.findFirst({ where: eq(user.id, me.id) }))!;
  const bot = telegramConfigured() ? telegramBot() : null;

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="page-title">{t("account.title")}</h1>
        <p className="text-sm text-gray-500">
          {u.name} · <span className="font-mono">{u.username}</span> · {t(`roles.${me.role as Role}`)}
        </p>
      </div>

      <section className="card space-y-4">
        <h2 className="font-medium">{t("account.notifications")}</h2>
        <p className="text-sm text-gray-500">{t("account.notificationsHelp")}</p>
        <ActionForm action={updateMyNotifications} className="space-y-3">
          <div>
            <label className="label" htmlFor="email">
              {t("account.email")}
            </label>
            <input id="email" name="email" type="email" defaultValue={u.contactEmail ?? ""} className="input" autoComplete="email" />
            {!emailConfigured() && <p className="mt-1 text-xs text-amber-700">{t("account.emailOff")}</p>}
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" name="notifyEmail" className="h-5 w-5" defaultChecked={u.notifyEmail} />
            {t("account.byEmail")}
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" name="notifyTelegram" className="h-5 w-5" defaultChecked={u.notifyTelegram} />
            {t("account.byTelegram")}
          </label>
          <SubmitButton className="btn">{t("common.save")}</SubmitButton>
        </ActionForm>

        <div className="space-y-2 border-t border-gray-100 pt-4">
          <div className="text-sm font-medium">Telegram</div>
          {u.telegramChatId ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-green-700">✓ {t("account.connectedAs", { name: u.telegramName ?? "Telegram" })}</span>
              <ActionButton action={disconnectMyTelegram} args={[]} className="btn btn-sm" confirm={t("account.disconnectConfirm")}>
                {t("account.disconnect")}
              </ActionButton>
            </div>
          ) : bot ? (
            <TelegramConnect bot={bot} />
          ) : (
            <p className="text-sm text-gray-500">{t("account.telegramOff")}</p>
          )}
        </div>

        <div className="border-t border-gray-100 pt-4">
          <ActionButton action={sendMeTest} args={[]} className="btn btn-sm" showOk>
            {t("account.sendTest")}
          </ActionButton>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="font-medium">{t("account.changePassword")}</h2>
        <ChangePasswordForm min={PASSWORD_MIN} />
      </section>
    </div>
  );
}
