import type en from "../../messages/en.json";
import type { Locale } from "./config";

// Type-checks every translation key against the English messages.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
