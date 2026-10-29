"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { changePassword, requestPasswordReset, setPasswordWithLink } from "@/app/actions/password";
import type { ActionState } from "@/lib/action-state";

function Result({ state }: { state: ActionState }) {
  if (state.error) return <p className="text-sm text-red-600">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-green-700">{state.ok}</p>;
  return null;
}

/** New password twice, with a "show" switch (typing blind on a phone is error-prone). */
function NewPassword({ min }: { min: number }) {
  const t = useTranslations("setPassword");
  const [show, setShow] = useState(false);
  const type = show ? "text" : "password";
  return (
    <>
      <div>
        <label className="label" htmlFor="password">
          {t("new")}
        </label>
        <input id="password" name="password" type={type} className="input" autoComplete="new-password" minLength={min} required />
        <p className="mt-1 text-xs text-gray-500">{t("rule", { min })}</p>
      </div>
      <div>
        <label className="label" htmlFor="repeat">
          {t("repeat")}
        </label>
        <input id="repeat" name="repeat" type={type} className="input" autoComplete="new-password" minLength={min} required />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={show} onChange={(e) => setShow(e.target.checked)} />
        {t("show")}
      </label>
    </>
  );
}

export function SetPasswordForm({ token, username, min }: { token: string; username: string; min: number }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(setPasswordWithLink, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers save the login together with the new password. */}
      <div>
        <label className="label" htmlFor="username">
          {t("common.username")}
        </label>
        <input id="username" name="username" value={username} readOnly autoComplete="username" className="input bg-gray-50 font-mono" />
      </div>
      <NewPassword min={min} />
      <Result state={state} />
      <button className="btn btn-primary min-h-12 w-full" disabled={pending}>
        {pending ? "…" : t("setPassword.save")}
      </button>
    </form>
  );
}

export function ForgotForm() {
  const t = useTranslations();
  const [state, action, pending] = useActionState(requestPasswordReset, {});
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="username">
          {t("common.username")}
        </label>
        <input id="username" name="username" className="input" autoComplete="username" autoCapitalize="none" required />
      </div>
      <Result state={state} />
      <button className="btn btn-primary min-h-12 w-full" disabled={pending}>
        {pending ? "…" : t("forgot.send")}
      </button>
    </form>
  );
}

export function ChangePasswordForm({ min }: { min: number }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(changePassword, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="current">
          {t("account.currentPassword")}
        </label>
        <input id="current" name="current" type="password" className="input" autoComplete="current-password" required />
      </div>
      <NewPassword min={min} />
      <Result state={state} />
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "…" : t("account.changePassword")}
      </button>
    </form>
  );
}
