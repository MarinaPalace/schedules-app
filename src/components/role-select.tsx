import type { getTranslations } from "next-intl/server";
import type { Role } from "@/lib/session";

/** Role dropdown limited to the roles the current user may hand out. */
export function RoleSelect({
  roles,
  value,
  t,
  disabled,
}: {
  roles: Role[];
  value?: string;
  t: Awaited<ReturnType<typeof getTranslations<never>>>;
  disabled?: boolean;
}) {
  return (
    <select name="role" defaultValue={value ?? "employee"} className="input" disabled={disabled}>
      {roles.map((r) => (
        <option key={r} value={r}>
          {t(`roles.${r}`)}
        </option>
      ))}
    </select>
  );
}
