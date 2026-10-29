import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getSetting } from "@/lib/settings";

export default async function Home() {
  const user = await requireUser();
  // The owner's first login: a short welcome that sets up the hotel, then the checklist takes over.
  if ((user.role === "owner" || user.role === "admin") && (await getSetting("welcome_done")) !== "1") redirect("/welcome");
  redirect(user.role === "employee" ? "/me" : "/dashboard");
}
