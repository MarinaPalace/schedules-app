"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { importStaff, type ImportResult } from "@/app/(app)/admin/employees/actions";
import { IMPORT_COLUMNS, parseRows } from "@/lib/import-rows";

const COLUMNS = IMPORT_COLUMNS;

export function StaffImport({ departments, defaultDept }: { departments: { id: string; name: string }[]; defaultDept: string | null }) {
  const t = useTranslations("import");
  const router = useRouter();
  const [dept, setDept] = useState(defaultDept ?? departments[0]?.id ?? "");
  const [text, setText] = useState("");
  const [logins, setLogins] = useState(true);
  const [createRoles, setCreateRoles] = useState(true);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  const rows = useMemo(() => parseRows(text), [text]);
  const bad = new Map((res?.rowErrors ?? []).map((e) => [e.row, e.error]));

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          {departments.length > 1 && (
            <div>
              <label className="label" htmlFor="imp-dept">{t("department")}</label>
              <select id="imp-dept" className="input" value={dept} onChange={(e) => setDept(e.target.value)}>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={logins} onChange={(e) => setLogins(e.target.checked)} /> {t("logins")}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={createRoles} onChange={(e) => setCreateRoles(e.target.checked)} /> {t("createRoles")}
          </label>
        </div>
        <div>
          <label className="label" htmlFor="imp-text">{t("paste")}</label>
          <textarea
            id="imp-text"
            className="input min-h-40 font-mono text-xs"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setRes(null);
            }}
            placeholder={t("example")}
          />
          <p className="mt-1 text-xs text-gray-500">{t("columns")}</p>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card overflow-x-auto p-0 sm:p-0">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                {COLUMNS.map((c) => (
                  <th key={c}>{t(`col.${c}`)}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={bad.has(i + 1) ? "bg-red-50" : ""}>
                  <td className="text-gray-400">{i + 1}</td>
                  {COLUMNS.map((c) => (
                    <td key={c} className="text-xs">{r[c]}</td>
                  ))}
                  <td className="text-xs text-red-600">{bad.get(i + 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary min-h-12"
          disabled={!rows.length || !dept || pending}
          onClick={() =>
            start(async () => {
              const r = await importStaff(dept, rows, { logins, createRoles });
              setRes(r);
              if (r.ok) router.refresh();
            })
          }
        >
          {pending ? "…" : t("go", { count: rows.length })}
        </button>
        {res?.error && <span className="text-sm text-red-600">{res.error}</span>}
        {res?.rowErrors && <span className="text-sm text-red-600">{t("fix", { count: res.rowErrors.length })}</span>}
      </div>

      {res?.ok && (
        <div className="card space-y-2 border-green-200 bg-green-50 text-sm">
          <p className="font-medium text-green-800">{res.ok}</p>
          <ul className="space-y-0.5">
            {res.created?.map((c) => (
              <li key={c.name}>
                {c.name} {c.username && <span className="font-mono text-gray-600">· {c.username}</span>}{" "}
                {c.username && <span className={c.sent ? "text-green-700" : "text-amber-700"}>{c.sent ? `✓ ${t("sent")}` : t("useSlips")}</span>}
              </li>
            ))}
          </ul>
          <a href={`/admin/employees/slips?dept=${dept}`} target="_blank" rel="noopener" className="btn btn-primary">
            🖨 {t("printSlips")}
          </a>
        </div>
      )}
    </div>
  );
}
