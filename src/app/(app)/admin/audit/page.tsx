import Link from "next/link";
import { and, desc, eq, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, user } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { formatDateTime } from "@/lib/dates";
import { getTranslations } from "next-intl/server";

const PAGE = 50;

/** Fields that changed between old and new row. */
function diff(oldData: unknown, newData: unknown): string {
  const o = (oldData ?? {}) as Record<string, unknown>;
  const n = (newData ?? {}) as Record<string, unknown>;
  const skip = new Set(["id", "created_at", "updated_at"]);
  return Object.keys(n)
    .filter((k) => !skip.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
    .map((k) => (oldData ? `${k}: ${JSON.stringify(o[k])} → ${JSON.stringify(n[k])}` : `${k}: ${JSON.stringify(n[k])}`))
    .join("\n");
}

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireUser(["admin", "owner"]);
  const t = await getTranslations();
  const { table, before } = (await searchParams) as { table?: string; before?: string };

  const filters: SQL[] = [];
  if (table) filters.push(eq(auditEvents.tableName, table));
  if (before && /^\d+$/.test(before)) filters.push(lt(auditEvents.id, Number(before)));

  const [rows, tables, chain] = await Promise.all([
    db
      .select({ e: auditEvents, actor: user.name })
      .from(auditEvents)
      .leftJoin(user, eq(user.id, auditEvents.actorId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditEvents.id))
      .limit(PAGE),
    db.selectDistinct({ t: auditEvents.tableName }).from(auditEvents).orderBy(auditEvents.tableName),
    db.execute(sql`select app_verify_audit_chain() as broken, count(*)::int as n from audit_events`),
  ]);
  const { broken, n } = (chain as unknown as { rows: { broken: string | null; n: number }[] }).rows[0];
  const last = rows.at(-1)?.e.id;

  return (
    <div className="max-w-6xl space-y-4">
      <h1 className="page-title">{t("audit.title")}</h1>

      <div className={`card text-sm ${broken === null ? "border-green-200 bg-green-50" : "border-red-300 bg-red-50"}`}>
        {broken === null ? (
          <>{t("audit.intact", { count: n })}</>
        ) : (
          <>{t("audit.broken", { id: String(broken) })}</>
        )}
      </div>

      <form className="flex items-center gap-2 text-sm">
        <select name="table" defaultValue={table ?? ""} className="input w-auto">
          <option value="">{t("audit.allTables")}</option>
          {tables.map(({ t }) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button className="btn">{t("common.filter")}</button>
      </form>

      <div className="card overflow-x-auto p-0 sm:p-0">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t("audit.when")}</th>
              <th>{t("audit.who")}</th>
              <th>{t("audit.what")}</th>
              <th>{t("audit.changes")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, actor }) => (
              <tr key={e.id} className="align-top">
                <td className="text-gray-400 tabular-nums">{e.id}</td>
                <td className="whitespace-nowrap">{formatDateTime(e.at)}</td>
                <td className="whitespace-nowrap">{actor ?? (e.tableName === "session" ? t("common.login") : t("common.system"))}</td>
                <td className="whitespace-nowrap">
                  <span className="badge">{e.operation === "INSERT" ? t("audit.created") : t("audit.changed")}</span> {e.tableName}
                </td>
                <td>
                  <pre className="max-w-xl font-mono text-xs whitespace-pre-wrap text-gray-600">{diff(e.oldData, e.newData)}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === PAGE && last && (
        <Link className="btn" href={`/admin/audit?${new URLSearchParams({ ...(table ? { table } : {}), before: String(last) })}`}>
          {t("audit.older")}
        </Link>
      )}
    </div>
  );
}
