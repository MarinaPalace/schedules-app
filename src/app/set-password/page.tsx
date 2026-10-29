import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { findLink } from "@/lib/login-links";
import { PASSWORD_MIN } from "@/lib/users";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SetPasswordForm } from "@/components/password-forms";

/** Opened from an invite or reset link (email, Telegram or QR). */
export default async function SetPasswordPage({ searchParams }: PageProps<"/set-password">) {
  const t = await getTranslations();
  const token = String((await searchParams).token ?? "");
  const found = token ? await findLink(token, ["setup", "reset"]) : null;

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="card w-full max-w-sm space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{found?.link.purpose === "setup" ? t("setPassword.welcome", { name: found.user.name }) : t("setPassword.title")}</h1>
            <p className="text-sm text-gray-500">{t("common.appName")}</p>
          </div>
          <LanguageSwitcher />
        </div>
        {found ? (
          <SetPasswordForm token={token} username={found.user.username ?? ""} min={PASSWORD_MIN} />
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-red-600">{t("errors.linkInvalid")}</p>
            <Link href="/forgot" className="btn w-full">
              {t("login.forgot")}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
