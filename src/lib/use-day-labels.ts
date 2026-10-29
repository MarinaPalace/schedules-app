"use client";

import { useTranslations } from "next-intl";
import { ABSENCE_CODES, type DayLabels } from "@/lib/codes";

export function useDayLabels(): DayLabels {
  const t = useTranslations();
  return {
    dayOff: t("common.dayOff"),
    hourUnit: t("common.hourUnit"),
    minuteUnit: t("common.minuteUnit"),
    absence: Object.fromEntries(ABSENCE_CODES.map((c) => [c, t(`absence.${c}`)])),
  };
}
