"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.username({
      username: String(form.get("username")).trim().toLowerCase(),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) {
      setError(error.status === 403 ? t("login.deactivated") : error.status === 429 ? t("login.tooMany") : t("login.wrong"));
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t("common.appName")}</h1>
            <p className="text-sm text-gray-500">{t("login.subtitle")}</p>
          </div>
          <LanguageSwitcher />
        </div>
        <div>
          <label className="label" htmlFor="username">{t("common.username")}</label>
          <input id="username" name="username" className="input" autoComplete="username" autoCapitalize="none" required />
        </div>
        <div>
          <label className="label" htmlFor="password">{t("common.password")}</label>
          <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn btn-primary w-full" disabled={pending}>
          {pending ? t("login.signingIn") : t("login.signIn")}
        </button>
        <Link href="/forgot" className="block text-center text-sm text-blue-700 hover:underline">
          {t("login.forgot")}
        </Link>
      </form>
    </main>
  );
}
