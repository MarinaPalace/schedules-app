"use client";

import { useTranslations } from "next-intl";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type CostPoint = { day: string; budget: number | null; actual: number | null; projected: number };

const ACTUAL = "#2a78d6"; // categorical slot 1
const PROJECTED = "#eb6834"; // categorical slot 2
const REFERENCE = "#9ca3af"; // neutral – budget pace is a reference, not a series

const eur = (v: number) => new Intl.NumberFormat("bg-BG", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

/** Cumulative labour cost through the month vs straight-line budget pace. Values in euros. */
export function CostChart({ data, todayDay }: { data: CostPoint[]; todayDay: string | null }) {
  const t = useTranslations("chart");
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="#eef0f3" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} interval="preserveStartEnd" />
          <YAxis tickFormatter={eur} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} width={80} />
          <Tooltip
            formatter={(v, name) => [typeof v === "number" ? eur(v) : "—", name]}
            labelFormatter={(l) => t("day", { day: String(l) })}
            contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e5e7eb" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
          {todayDay && <ReferenceLine x={todayDay} stroke="#d1d5db" label={{ value: t("today"), fontSize: 10, fill: "#6b7280", position: "insideTopRight" }} />}
          <Line name={t("budgetPace")} dataKey="budget" stroke={REFERENCE} strokeWidth={2} strokeDasharray="2 4" dot={false} isAnimationActive={false} />
          <Line name={t("projected")} dataKey="projected" stroke={PROJECTED} strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          <Line name={t("actual")} dataKey="actual" stroke={ACTUAL} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
