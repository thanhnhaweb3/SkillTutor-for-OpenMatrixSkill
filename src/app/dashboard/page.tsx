"use client";

import type { DashboardErrorBody, DashboardMe } from "@openmatrix/dashboard";
import { ArrowRight, BookOpen, BookOpenCheck, Gauge, Loader2, MessageCircle, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/LocaleProvider";
import { apiErrorText } from "../../i18n/messages";

type DashboardState =
  | { status: "loading"; message: string }
  | { status: "ready"; data: DashboardMe }
  | { status: "error"; error: DashboardErrorBody["error"] };

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<DashboardState>({ status: "loading", message: t("dashboard.verifying") });

  useEffect(() => {
    const controller = new AbortController();
    const loadDashboard = async () => {
      let response = await fetch("/api/dashboard/me", { signal: controller.signal, cache: "no-store" });
      let body = (await response.json()) as DashboardMe | DashboardErrorBody;
      if (!response.ok && (body as DashboardErrorBody).error?.code === "NOT_MEMBER") {
        setState({ status: "loading", message: t("dashboard.activating") });
        const bootstrap = await fetch("/api/dashboard/bootstrap", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: "{}",
          signal: controller.signal
        });
        const bootstrapBody = (await bootstrap.json()) as DashboardErrorBody;
        if (!bootstrap.ok) throw bootstrapBody.error;
        response = await fetch("/api/dashboard/me", { signal: controller.signal, cache: "no-store" });
        body = (await response.json()) as DashboardMe | DashboardErrorBody;
      }
      if (!response.ok) throw (body as DashboardErrorBody).error;
      setState({ status: "ready", data: body as DashboardMe });
    };
    void loadDashboard()
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const contractError = error as Partial<DashboardErrorBody["error"]>;
        setState({
          status: "error",
          error: {
            code: contractError.code ?? "INTERNAL_ERROR",
            message: contractError.message ?? "The dashboard could not be loaded.",
            requestId: contractError.requestId ?? "unknown"
          }
        });
      });
    return () => controller.abort();
  }, [t]);

  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="rounded-xl border border-ink/10 bg-white/85 p-4 shadow-sm sm:p-6">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-lagoon/10 text-lagoon">
            <Gauge aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-lagoon">{t("dashboard.phase")}</p>
            <h1 className="mt-1 text-3xl font-semibold text-ink">{t("dashboard.title")}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/65">
              {t("dashboard.description")}
            </p>
          </div>
        </div>
      </header>

      {state.status === "loading" ? (
        <section className="mt-6 flex items-center gap-3 rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink/65 sm:p-6">
          <Loader2 className="animate-spin text-lagoon" aria-hidden="true" />
          {state.message}
        </section>
      ) : state.status === "error" ? (
        <section className="mt-6 rounded-xl border border-coral/20 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 shrink-0 text-coral" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="font-semibold text-ink">{t("dashboard.cannotOpen")}</h2>
              <p className="mt-2 text-sm text-ink/65">{apiErrorText(locale, state.error)}</p>
              <p className="wrap-anywhere mt-3 font-mono text-xs text-ink/45">
                {state.error.code} · {state.error.requestId}
              </p>
              {state.error.code === "UNAUTHENTICATED" ? (
                <a className="mt-4 inline-flex rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white" href="/api/ac/auth/login?returnUrl=%2Fdashboard">
                  {t("nav.login")}
                </a>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="mt-6 grid gap-4 md:grid-cols-4">
            <DashboardCard icon={<Gauge />} label={t("dashboard.activeExpert")} value={state.data.activeExpert.displayName} />
            <DashboardCard icon={<ShieldCheck />} label={t("dashboard.membership")} value={state.data.memberships[0]?.tier === "free" ? "Free" : state.data.memberships[0]?.tier ?? "—"} />
            <DashboardCard icon={<Users />} label={t("dashboard.memberships")} value={String(state.data.memberships.length)} />
            <DashboardCard icon={<ShieldCheck />} label={t("dashboard.permissions")} value={String(state.data.permissions.length)} />
          </section>
          <section className="mt-6 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <BookOpen className="shrink-0 text-lagoon" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="font-semibold text-ink">{t("dashboard.foundation")}</h2>
                <p className="mt-1 text-sm text-ink/60">
                  {t("dashboard.foundationDescription")}
                </p>
              </div>
              <Link href="/dashboard/skills" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white sm:ml-auto sm:w-auto sm:shrink-0">
                {t("dashboard.openSkills")} <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            <div className="mt-4 flex flex-col items-stretch gap-3 border-t border-ink/10 pt-4 sm:flex-row sm:items-center">
              <BookOpenCheck className="shrink-0 text-lagoon" aria-hidden="true" />
              <div className="min-w-0"><h3 className="font-semibold text-ink">{t("dashboard.coursesTitle")}</h3><p className="mt-1 text-sm text-ink/60">{t("dashboard.coursesDescription")}</p></div>
              <Link href="/dashboard/courses" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-lagoon/40 px-4 py-2 text-sm font-semibold text-lagoon sm:ml-auto sm:w-auto sm:shrink-0">{t("dashboard.openCourses")} <ArrowRight aria-hidden="true" /></Link>
            </div>
            <div className="mt-4 flex flex-col items-stretch gap-3 border-t border-ink/10 pt-4 sm:flex-row sm:items-center">
              <MessageCircle className="shrink-0 text-lagoon" aria-hidden="true" />
              <div className="min-w-0"><h3 className="font-semibold text-ink">SkillTutor</h3><p className="mt-1 text-sm text-ink/60">{t("dashboard.skillTutorDescription")}</p></div>
              <Link href="/dashboard/skilltutor" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-lagoon/40 px-4 py-2 text-sm font-semibold text-lagoon sm:ml-auto sm:w-auto sm:shrink-0">{t("dashboard.openSkillTutor")} <ArrowRight aria-hidden="true" /></Link>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function DashboardCard(props: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="min-w-0 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2 text-sm font-medium text-ink/55">
        <span className="text-lagoon">{props.icon}</span>
        {props.label}
      </div>
      <p className="wrap-anywhere mt-3 text-2xl font-semibold text-ink">{props.value}</p>
    </article>
  );
}
