"use client";

import { Home, Loader2, LogIn, LogOut, Menu, MessageCircle, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAcAuth } from "@openmatrix/oms-ac-login/react/hooks/useAcAuth";
import { useI18n } from "../../i18n/LocaleProvider";
import { LocaleSwitcher } from "./LocaleSwitcher";

const HOME_URL = "https://www.openmatrixskill.com";
const WORKSHOP_URL = process.env.NEXT_PUBLIC_APP_URL;

interface AppNavbarProps {
  skillTutorButtonVisible: boolean;
}

export function AppNavbar({ skillTutorButtonVisible }: AppNavbarProps) {
  const pathname = usePathname();
  const { status, user, logout } = useAcAuth();
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const loginHref = useMemo(() => {
    const returnUrl = pathname === "/login" ? "/settings/connections" : pathname || "/";
    return `/api/ac/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`;
  }, [pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const navItems = [
    { href: WORKSHOP_URL, label: t("nav.home"), icon: Home, active: pathname === "/" },
    ...(skillTutorButtonVisible
      ? [
          { href: "/dashboard/skilltutor", label: t("nav.skilltutor"), icon: MessageCircle, active: pathname.startsWith("/dashboard/skilltutor") }
        ]
      : [])
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-ink/10 bg-white/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <a
          className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-ink transition hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20 focus:ring-offset-2"
          href={HOME_URL}
          aria-label={t("nav.home")}
        >
          <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-ink/10">
            <img className="size-9 object-cover" src="/logo.webp" alt="" aria-hidden="true" />
          </span>
          <span className="hidden truncate sm:inline">OpenMatrix Skill</span>
        </a>

        <div className="ml-2 hidden items-center gap-2 lg:flex">
          {navItems.map(({ href, label, icon: Icon, active }) => (
            <a
              key={label}
              className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-lagoon/20 focus:ring-offset-2 ${active ? "border-lagoon/30 bg-lagoon/10 text-lagoon" : "border-ink/15 bg-white text-ink hover:border-lagoon/40 hover:text-lagoon"}`}
              href={href}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </a>
          ))}
        </div>

        <div className="ml-auto hidden min-w-0 items-center gap-3 lg:flex">
          <LocaleSwitcher />
          {user ? (
            <span className="hidden max-w-[13.75rem] truncate text-sm text-ink/65 md:block">
              {user.email}
            </span>
          ) : null}

          {status === "loading" ? (
            <button
              className="inline-flex min-h-10 min-w-[8rem] items-center justify-center gap-2 whitespace-nowrap rounded-md border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink/60 shadow-sm"
              type="button"
              disabled
            >
              <Loader2 className="animate-spin" size={16} aria-hidden="true" />
              {t("nav.loading")}
            </button>
          ) : user ? (
            <button
              className="inline-flex min-h-10 min-w-[8rem] items-center justify-center gap-2 whitespace-nowrap rounded-md border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm transition hover:border-coral/40 hover:text-coral focus:outline-none focus:ring-2 focus:ring-coral/20 focus:ring-offset-2"
              type="button"
              onClick={logout}
            >
              <LogOut size={16} aria-hidden="true" />
              {t("nav.logout")}
            </button>
          ) : (
            <a
              className="inline-flex min-h-10 min-w-[8rem] items-center justify-center gap-2 whitespace-nowrap rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-lagoon/90 focus:outline-none focus:ring-2 focus:ring-lagoon/25 focus:ring-offset-2"
              href={loginHref}
            >
              <LogIn size={16} aria-hidden="true" />
              {t("nav.login")}
            </a>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 lg:hidden">
          <LocaleSwitcher />
          <button
            className="inline-flex size-10 items-center justify-center rounded-md border border-ink/15 bg-white text-ink shadow-sm transition hover:border-lagoon/40 hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20 focus:ring-offset-2"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            aria-label={menuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div id="mobile-navigation" className="max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-t border-ink/10 bg-white px-4 py-3 shadow-lg lg:hidden">
          <div className="mx-auto grid w-full max-w-6xl gap-2">
            {navItems.map(({ href, label, icon: Icon, active }) => (
              <a
                key={label}
                className={`flex min-h-12 items-center gap-3 rounded-lg px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-lagoon/20 ${active ? "bg-lagoon/10 text-lagoon" : "text-ink hover:bg-ink/5"}`}
                href={href}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={19} aria-hidden="true" />
                {label}
              </a>
            ))}

            <div className="my-1 border-t border-ink/10" />
            {user ? <span className="wrap-anywhere px-4 text-sm text-ink/65">{user.email}</span> : null}
            {status === "loading" ? (
              <button className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-ink/15 bg-white px-4 text-sm font-semibold text-ink/60" type="button" disabled>
                <Loader2 className="animate-spin" size={17} aria-hidden="true" />
                {t("nav.loading")}
              </button>
            ) : user ? (
              <button
                className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-coral/25 bg-white px-4 text-sm font-semibold text-coral transition hover:bg-coral/5 focus:outline-none focus:ring-2 focus:ring-coral/20"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void logout();
                }}
              >
                <LogOut size={17} aria-hidden="true" />
                {t("nav.logout")}
              </button>
            ) : (
              <a className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-lagoon px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-lagoon/90 focus:outline-none focus:ring-2 focus:ring-lagoon/25" href={loginHref}>
                <LogIn size={17} aria-hidden="true" />
                {t("nav.login")}
              </a>
            )}
          </div>
        </div>
      ) : null}
    </nav>
  );
}
