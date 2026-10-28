import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hotel Schedules",
  description: "Schedules, Forma 76 and labour budget for the hotel",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "Schedules" },
};

export const viewport: Viewport = { themeColor: "#2563eb", viewportFit: "cover" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  // "light" / "dark" force a theme; otherwise CSS follows the device setting.
  const theme = (await cookies()).get("theme")?.value;
  const themeClass = theme === "light" || theme === "dark" ? theme : "";
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} ${themeClass} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
