import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AcLoginProvider } from "@openmatrix/oms-ac-login/react/AcLoginProvider";
import { AppNavbar } from "./components/AppNavbar";
import { AppFooter } from "./components/AppFooter";
import { FloatingControls } from "./components/FloatingControls";
import { cookies } from "next/headers";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { LocaleProfileSync } from "../i18n/LocaleProfileSync";
import { messages } from "../i18n/messages";
import type { SupportedLocale } from "@openmatrix/oms-ac-login";
import { localeFromCookie } from "../i18n/locale";

export function generateMetadata(): Metadata {
  const locale: SupportedLocale = localeFromCookie(cookies().get("oms-locale")?.value);
  return {
    title: messages[locale]["meta.title"],
    description: messages[locale]["meta.description"],
    icons: {
      icon: "/logo.webp",
      shortcut: "/logo.webp",
      apple: "/logo.webp"
    }
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale: SupportedLocale = localeFromCookie(cookies().get("oms-locale")?.value);
  const skillTutorButtonVisible =
    process.env.NAVBAR_SKILLTUTOR_BUTTON_VISIBLE?.trim().toLowerCase() !== "false";
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('oms-theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()` }} />
      </head>
      <body>
        <LocaleProvider initialLocale={locale}>
          <AcLoginProvider>
            <LocaleProfileSync />
            <div className="flex min-h-screen flex-col">
              <AppNavbar skillTutorButtonVisible={skillTutorButtonVisible} />
              <main className="flex-1">{children}</main>
              <AppFooter />
              <FloatingControls />
            </div>
          </AcLoginProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
