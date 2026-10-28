"use client";

import { Award, BadgeCheck, BookOpen, Gauge, MessageCircle, MessagesSquare, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "./useT";

const TABS = [
  { href: "/dashboard/skilltutor", key: "st.tabOverview", icon: Gauge, exact: true },
  { href: "/dashboard/skilltutor/courses", key: "st.tabCourses", icon: BookOpen },
  { href: "/dashboard/skilltutor/learn", key: "st.tabLearn", icon: MessagesSquare },
  { href: "/dashboard/skilltutor/certificates", key: "st.tabCertificates", icon: Award },
  { href: "/dashboard/skilltutor/verify", key: "st.tabVerify", icon: BadgeCheck }
] as const;
const ADMIN_TAB = { href: "/dashboard/skilltutor/learners", key: "st.tabLearners", icon: Users } as const;

export default function SkillTutorLayout({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const pathname = usePathname();
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    // Only Expert admins (expert:manage_members) see the learner approval tab.
    fetch("/api/dashboard/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((me: { permissions?: string[] } | null) => setCanManage(!!me?.permissions?.includes("expert:manage_members"))).catch(() => undefined);
  }, []);
  const tabs = canManage || pathname.startsWith(ADMIN_TAB.href) ? [...TABS, ADMIN_TAB] : TABS;
  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="rounded-xl border border-ink/10 bg-white/85 p-4 shadow-sm sm:p-6">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-lagoon/10 text-lagoon"><MessageCircle aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-lagoon">{t("st.badge")}</p>
            <h1 className="mt-1 text-3xl font-semibold text-ink">{t("st.title")}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/65">{t("st.description")}</p>
          </div>
        </div>
        <nav className="mt-4 flex gap-2 overflow-x-auto border-t border-ink/10 pt-4" aria-label={t("st.title")}>
          {tabs.map(({ href, key, icon: Icon, ...rest }) => {
            const active = "exact" in rest ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${active ? "bg-lagoon text-white" : "border border-ink/10 text-ink/70 hover:border-lagoon/40 hover:text-lagoon"}`}>
                <Icon size={16} aria-hidden="true" /> {t(key)}
              </Link>
            );
          })}
        </nav>
      </header>
      {children}
    </main>
  );
}
