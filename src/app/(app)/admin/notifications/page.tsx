import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db } from "@/db/client";
import { notifications, user } from "@/db/schema";
import { appUrl } from "@/lib/app-url";
import { formatDateTime } from "@/lib/dates";
import { emailConfigured, mailFrom, telegramApi, telegramBot, telegramConfigured } from "@/lib/notify/channels";
import { requireUser } from "@/lib/session";
import { ActionButton } from "@/components/action-button";
import { connectTelegramWebhook } from "./actions";

type WebhookInfo = { url: string; pending_update_count: number; last_error_message?: string };

export default async function NotificationsAdminPage() {
  await requireUser(["admin", "owner"]);
  const t = await getTranslations("notifyAdmin");
  const hook = telegramConfigured() ? await telegramApi<WebhookInfo>("getWebhookInfo").catch((e: Error) => ({ error: e.message })) : null;
  const expected = appUrl("/api/telegram/webhook");
  const log = await db
    .select({ n: notifications, who: user.name })
    .from(notifications)
    .leftJoin(user, eq(user.id, notifications.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(150);
  const STATUS: Record<string, string> = { sent: "bg-green-100 text-green-800", failed: "bg-red-100 text-red-800", not_configured: "" };

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="page-title">{t("title")}</h1>
        <p className="text-sm text-gray-500">{t("help")}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="card space-y-2 text-sm">
          <h2 className="font-medium">{t("email")}</h2>
          {emailConfigured() ? (
            <p className="text-green-700">✓ {t("emailOn", { from: mailFrom() })}</p>
          ) : (
            <p className="text-amber-700">{t("emailSetup")}</p>
          )}
        </section>
        <section className="card space-y-2 text-sm">
          <h2 className="font-medium">Telegram</h2>
          {!telegramConfigured() ? (
            <p className="text-amber-700">{t("telegramSetup")}</p>
          ) : (
            <>
              <p className="text-green-700">✓ {t("botOn", { bot: `@${telegramBot() ?? "?"}` })}</p>
              {hook && "error" in hook ? (
                <p className="text-red-600">{hook.error}</p>
              ) : hook?.url === expected ? (
                <p className="text-green-700">✓ {t("webhookOn")}</p>
              ) : (
                <p className="text-amber-700">{t("webhookOff", { url: expected })}</p>
              )}
              {hook && !("error" in hook) && hook.last_error_message && <p className="text-xs text-red-600">{hook.last_error_message}</p>}
              <ActionButton action={connectTelegramWebhook} args={[]} className="btn btn-sm">
                {t("connectWebhook")}
              </ActionButton>
            </>
          )}
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">{t("log")}</h2>
        <div className="card overflow-x-auto p-0 sm:p-0">
          <table className="table">
            <thead>
              <tr>
                <th>{t("when")}</th>
                <th>{t("to")}</th>
                <th>{t("what")}</th>
                <th>{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {log.map(({ n, who }) => (
                <tr key={n.id}>
                  <td className="whitespace-nowrap">{formatDateTime(n.createdAt)}</td>
                  <td className="text-xs">
                    <div className="font-medium">{who}</div>
                    <div className="text-gray-500">
                      {n.channel === "email" ? "✉" : "✈"} {n.recipient}
                    </div>
                  </td>
                  <td className="text-xs">
                    <details>
                      <summary className="cursor-pointer">{n.subject}</summary>
                      <pre className="mt-1 max-w-md font-sans whitespace-pre-wrap text-gray-600">{n.body}</pre>
                    </details>
                  </td>
                  <td>
                    <span className={`badge ${STATUS[n.status] ?? ""}`}>{t(`state.${n.status as "sent" | "failed" | "not_configured"}`)}</span>
                    {n.error && <div className="mt-1 max-w-56 text-xs text-red-600">{n.error}</div>}
                  </td>
                </tr>
              ))}
              {log.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-500">
                    {t("empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
