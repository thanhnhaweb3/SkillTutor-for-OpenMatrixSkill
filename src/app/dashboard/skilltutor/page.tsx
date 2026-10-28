"use client";

import { Loader2, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorText } from "../../../i18n/messages";
import { SkillTutorPanel } from "../../settings/connections/SkillTutorPanel";
import { useT } from "./useT";
import { WhatsAppDiagnostics } from "./WhatsAppDiagnostics";

interface Overview {
  expertId: string;
  mode: { llm: string; agent: string; channels: string; store: string };
  totals: { linkedLearners: number; active7d: number; lessonsDelivered: number; lessonsCompleted: number; quizPassed: number; quizFailed: number; certificates: number; nudges: number; reactivationRate: number };
  byChannel: { channel: string; messages: number; nudges: number }[];
  learners: { name: string; linked: boolean; preferredChannel: string; daysInactive: number; rescueStage: number; inQuiz: boolean }[];
  recent: { at: string; type: string; channel?: string }[];
}
interface SimMessage { at: string; direction: "in" | "out"; channel: string; text: string; interactive?: { options: { id: string; title: string }[] } }
interface SimOutbox { id: string; at: string; channel: string; to: { phone?: string; email?: string }; text: string; subject?: string; template?: { name: string; params: string[] } }

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email (SES)", simulator: "Simulator" };
const json = { "content-type": "application/json" };

export default function SkillTutorDashboard() {
  const { t, locale } = useT();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescueBusy, setRescueBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/skilltutor/overview", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) { setError(body.error?.code ?? "ERROR"); return; }
    setOverview(body as Overview);
    setError(null);
  }, []);
  useEffect(() => { void load().catch(() => setError("ERROR")); }, [load]);

  async function runRescue() {
    setRescueBusy(true);
    try { await fetch("/api/skilltutor/rescue/run", { method: "POST", headers: json, body: "{}" }); await load(); } finally { setRescueBusy(false); }
  }

  const totals = overview?.totals;
  const attempts = totals ? totals.quizPassed + totals.quizFailed : 0;
  return (
    <>
      {overview ? <p className="mt-3 font-mono text-xs text-ink/45">LLM {overview.mode.llm} · agent {overview.mode.agent} · channels {overview.mode.channels} · store {overview.mode.store}</p> : null}
      {error === "MISSING_PERMISSION" || error === "NOT_MEMBER" ? (
        <div className="mt-6"><SkillTutorPanel /></div>
      ) : error ? (
        <section className="mt-6 flex items-start gap-3 rounded-xl border border-coral/20 bg-white p-4 shadow-sm sm:p-6">
          <ShieldCheck className="mt-0.5 shrink-0 text-coral" aria-hidden="true" />
          <div><h2 className="font-semibold text-ink">{t("st.errorTitle")}</h2><p className="mt-1 text-sm text-ink/65">{apiErrorText(locale, { code: error })}</p><p className="mt-1 font-mono text-xs text-ink/45">{error}</p>
            {error === "UNAUTHENTICATED" ? <a className="mt-3 inline-flex rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white" href="/api/ac/auth/login?returnUrl=%2Fdashboard%2Fskilltutor">{t("nav.login")}</a> : null}</div>
        </section>
      ) : !overview || !totals ? (
        <section className="mt-6 flex items-center gap-3 rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink/65"><Loader2 className="animate-spin text-lagoon" aria-hidden="true" />{t("st.loading")}</section>
      ) : (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <Stat label={t("st.statLinked")} value={totals.linkedLearners} hint={t("st.statLinkedHint", { n: totals.active7d })} />
            <Stat label={t("st.statLessons")} value={totals.lessonsDelivered} hint={t("st.statLessonsHint", { n: totals.lessonsCompleted })} />
            <Stat label={t("st.statPass")} value={`${attempts ? Math.round((totals.quizPassed / attempts) * 100) : 0}%`} hint={t("st.statPassHint", { a: totals.quizPassed, b: attempts })} />
            <Stat label={t("st.statCerts")} value={totals.certificates} hint={t("st.statCertsHint")} />
            <Stat label={t("st.statNudges")} value={totals.nudges} hint={t("st.statNudgesHint")} />
            <Stat label={t("st.statReactivation")} value={`${totals.reactivationRate}%`} hint={t("st.statReactivationHint")} />
          </section>

          <div className="mt-6"><SkillTutorPanel /></div>

          <WhatsAppDiagnostics />

          <section className="mt-6 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <h2 className="font-semibold text-ink">{t("st.learnersTitle")}</h2>
              <button type="button" onClick={runRescue} disabled={rescueBusy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white sm:ml-auto">
                {rescueBusy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />} {t("st.runRescue")}
              </button>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs uppercase text-ink/50"><tr><th className="py-2 pr-3">{t("st.colLearner")}</th><th className="py-2 pr-3 text-right">{t("st.colInactive")}</th><th className="py-2 pr-3">{t("st.colRescue")}</th><th className="py-2 pr-3">{t("st.colChannel")}</th><th className="py-2">{t("st.colStatus")}</th></tr></thead>
                <tbody>
                  {overview.learners.map((l) => (
                    <tr key={l.name} className="border-t border-ink/10">
                      <td className="py-2 pr-3 text-ink">{l.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{l.daysInactive}</td>
                      <td className="py-2 pr-3">{l.rescueStage ? <span className="rounded-full border border-saffron px-2 text-saffron">{t("st.stage", { n: l.rescueStage })}</span> : <span className="rounded-full bg-lagoon/10 px-2 text-lagoon">{t("st.ok")}</span>}</td>
                      <td className="py-2 pr-3">{CHANNEL[l.preferredChannel] ?? l.preferredChannel}</td>
                      <td className="py-2 text-ink/60">{l.inQuiz ? t("st.inQuiz") : l.linked ? t("st.linked") : t("st.notLinked")}</td>
                    </tr>
                  ))}
                  {overview.learners.length === 0 ? <tr><td colSpan={5} className="py-3 text-ink/55">{t("st.noLearners")}</td></tr> : null}
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid gap-2 border-t border-ink/10 pt-4 sm:grid-cols-3">
              {overview.byChannel.map((c) => (
                <div key={c.channel} className="rounded-lg bg-mist/40 p-3 text-sm"><p className="font-semibold text-ink">{CHANNEL[c.channel]}</p><p className="text-ink/60">{t("st.channelStats", { m: c.messages, n: c.nudges })}</p></div>
              ))}
            </div>
          </section>

          {overview.mode.channels === "dryrun" ? <Simulator onChange={load} /> : null}
        </>
      )}
    </>
  );
}

function Stat(props: { label: string; value: string | number; hint: string }) {
  return (
    <article className="min-w-0 rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-ink/55">{props.label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{props.value}</p>
      <p className="text-xs text-ink/45">{props.hint}</p>
    </article>
  );
}

function Simulator(props: { onChange: () => void }) {
  const { t } = useT();
  const [phone, setPhone] = useState("+84909000111");
  const [channel, setChannel] = useState<"simulator" | "sms">("simulator");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [outbox, setOutbox] = useState<SimOutbox[]>([]);
  const [busy, setBusy] = useState(false);
  const chat = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/skilltutor/simulator?phone=${encodeURIComponent(phone)}`, { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json();
    setMessages(body.messages ?? []);
    setOutbox(body.outbox ?? []);
  }, [phone]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { chat.current?.scrollTo({ top: chat.current.scrollHeight }); }, [messages.length]);

  async function send(body: string) {
    if (!body.trim() || busy) return;
    setBusy(true); setText("");
    try {
      await fetch("/api/skilltutor/simulator", { method: "POST", headers: json, body: JSON.stringify({ phone, text: body, channel }) });
      await refresh(); props.onChange();
    } finally { setBusy(false); }
  }
  const visible = messages.filter((m) => m.channel !== "email");
  const lastOut = [...visible].reverse().find((m) => m.direction === "out");

  return (
    <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-ink">{t("st.simTitle")}</h2>
        <p className="mt-1 text-sm text-ink/60">{t("st.simDescription")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} aria-label={t("st.simPhone")} className="min-h-11 flex-1 rounded-md border border-ink/15 px-3 font-mono text-sm" />
          <select value={channel} onChange={(e) => setChannel(e.target.value as "simulator" | "sms")} aria-label={t("st.simChannel")} className="min-h-11 rounded-md border border-ink/15 px-3 text-sm">
            <option value="simulator">{t("st.simWhatsApp")}</option><option value="sms">SMS</option>
          </select>
        </div>
        <div ref={chat} className="mt-3 flex h-96 flex-col gap-2 overflow-y-auto rounded-lg bg-mist/40 p-3">
          {visible.length === 0 ? <p className="text-sm text-ink/50">{t("st.simEmpty")}</p> : null}
          {visible.map((m, i) => (
            <div key={i} className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${m.direction === "in" ? "self-end bg-lagoon text-white" : "self-start border border-ink/10 bg-white text-ink"}`}>
              {m.text}
              {m === lastOut && m.interactive?.options.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.interactive.options.map((o) => <button key={o.id} type="button" disabled={busy} onClick={() => send(o.id)} className="rounded-md border border-lagoon/40 px-2 py-1 text-xs font-semibold text-lagoon">{o.title}</button>)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("st.simPlaceholder")} className="min-h-11 flex-1 rounded-md border border-ink/15 px-3 text-sm" />
          <button type="submit" disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-lagoon px-4 text-sm font-semibold text-white">{busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}{t("st.send")}</button>
        </form>
      </div>
      <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm">
        <div className="flex items-center"><h2 className="font-semibold text-ink">{t("st.outbox")}</h2><button type="button" onClick={() => void refresh()} className="ml-auto text-sm font-semibold text-lagoon">{t("st.refresh")}</button></div>
        <ul className="mt-2 flex max-h-[30rem] flex-col overflow-y-auto">
          {outbox.length === 0 ? <li className="text-sm text-ink/50">{t("st.outboxEmpty")}</li> : null}
          {outbox.slice(0, 30).map((o) => (
            <li key={o.id} className="border-b border-ink/10 py-2 text-sm">
              <span className="rounded bg-lagoon/10 px-2 py-0.5 text-xs font-semibold text-lagoon">{CHANNEL[o.channel] ?? o.channel}</span>
              <span className="ml-2 text-xs text-ink/50">→ {o.to.phone ?? o.to.email} · {o.at.slice(11, 19)}</span>
              {o.template ? <p className="font-mono text-xs text-ink/55">template {o.template.name} [{o.template.params.join(", ")}]</p> : null}
              {o.subject ? <p className="font-semibold text-ink">{o.subject}</p> : null}
              <p className="whitespace-pre-wrap break-words text-ink/70">{o.text.length > 260 ? `${o.text.slice(0, 260)}…` : o.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
