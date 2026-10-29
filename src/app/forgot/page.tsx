import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ForgotForm } from "@/components/password-forms";

export default async function ForgotPage() {
  const t = await getTranslations();
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="card w-full max-w-sm space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t("forgot.title")}</h1>
            <p className="text-sm text-gray-500">{t("forgot.help")}</p>
          </div>
          <LanguageSwitcher />
        </div>
        <ForgotForm />
        <Link href="/login" className="block text-center text-sm text-blue-700 hover:underline">
          {t("forgot.back")}
        </Link>
      </div>
    </main>
  );
}
