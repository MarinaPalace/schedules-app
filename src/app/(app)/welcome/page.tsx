import { count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/schema";
import { getCostFactor } from "@/lib/data";
import { emailConfigured, telegramConfigured } from "@/lib/notify/channels";
import { requireUser } from "@/lib/session";
import { getDefaultLocale, getHotelName } from "@/lib/settings";
import { WelcomeWizard } from "@/components/welcome-wizard";

/** The owner's first steps (opened automatically until finished; can be reopened from the guide). */
export default async function WelcomePage() {
  const me = await requireUser(["owner", "admin"]);
  const [name, locale, factor, gms] = await Promise.all([
    getHotelName(),
    getDefaultLocale(),
    getCostFactor(),
    db.select({ n: count() }).from(user).where(eq(user.role, "top_manager")),
  ]);
  return (
    <WelcomeWizard
      hotelName={name ?? ""}
      locale={locale}
      factor={factor}
      isAdminAccount={me.role === "admin"}
      hasGm={Number(gms[0]?.n ?? 0) > 0}
      email={emailConfigured()}
      telegram={telegramConfigured()}
    />
  );
}
