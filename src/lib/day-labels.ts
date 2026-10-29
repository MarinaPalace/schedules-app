import "server-only";
import { getTranslations } from "next-intl/server";
import { ABSENCE_CODES, type DayLabels } from "@/lib/codes";

export async function getDayLabels(): Promise<DayLabels> {
  const t = await getTranslations();
  return {
    dayOff: t("common.dayOff"),
    hourUnit: t("common.hourUnit"),
    minuteUnit: t("common.minuteUnit"),
    absence: Object.fromEntries(ABSENCE_CODES.map((c) => [c, t(`absence.${c}`)])),
  };
}
