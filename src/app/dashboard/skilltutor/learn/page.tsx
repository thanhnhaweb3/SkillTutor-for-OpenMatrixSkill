"use client";

import { AlarmClock, Loader2, MessageCircle, Send, Smartphone } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorText } from "../../../../i18n/messages";
import { useT } from "../useT";
import { RichText as Rich } from "../../../components/RichText";

interface ChatMessage { at: string; direction: "in" | "out"; channel: string; text: string; interactive?: { options: { id: string; title: string }[] } }

const json = { "content-type": "application/json" };

export default function LearnPage() {
  const { t, locale } = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reminderTime, setReminderTime] = useState<string | undefined>();
  const [usage, setUsage] = useState<{ limit: number; remaining: number | null } | null>(null);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const chat = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/skilltutor/learn", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) { setError(body.error?.code ?? "ERROR"); setLoaded(true); return; }
    setMessages(body.messages ?? []);
    setReminderTime(body.reminderTime);
    setUsage(body.usage ?? null);
    setLinked(!!body.whatsapp?.linked);
    setError(null);
    setLoaded(true);
  }, []);
  useEffect(() => {
    // Opened from "My courses" → ?continue=<expertId>:<cohortId>[&action=quiz]: switch the tutor to that course,
    // then ask for the next lesson (or the test). Course switches and quiz starts don't use the AI quota.
    const params = new URLSearchParams(window.location.search);
    const target = params.get("continue");
    const [expertId, cohortId] = (target ?? "").split(":");
    if (!expertId || !cohortId) { void load(); return; }
    window.history.replaceState(null, "", window.location.pathname); // a reload must not repeat it
    (async () => {
      setBusy(true);
      try {
        for (const text of [`course:${expertId}:${cohortId}`, params.get("action") === "quiz" ? "start_quiz" : "next_lesson"]) {
          const res = await fetch("/api/skilltutor/learn", { method: "POST", headers: json, body: JSON.stringify({ text }) });
          if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error?.code ?? "learn.error"); break; }
        }
      } finally { await load(); setBusy(false); }
    })();
  }, [load]);
  useEffect(() => { chat.current?.scrollTo({ top: chat.current.scrollHeight, behavior: "smooth" }); }, [messages.length, busy]);

  async function send(body: string) {
    if (!body.trim() || busy) return;
    setBusy(true); setText("");
    setMessages((m) => [...m, { at: new Date().toISOString(), direction: "in", channel: "app", text: body }]);
    try {
      const res = await fetch("/api/skilltutor/learn", { method: "POST", headers: json, body: JSON.stringify({ text: body }) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error?.code ?? "learn.error"); }
      await load();
    } finally { setBusy(false); }
  }

  const channelLabel = (c: string) => (c === "sms" ? "SMS" : c === "app" ? t("learn.viaWeb") : c === "simulator" ? "Simulator" : "WhatsApp");
  const lastOut = [...messages].reverse().find((m) => m.direction === "out");
  const suggestions = (["learn.s1", "learn.s2", "learn.s3", "learn.s4", "learn.s5"] as const).map((k) => t(k));

  if (loaded && error && messages.length === 0) {
    return <section className="mt-6 rounded-xl border border-coral/20 bg-white p-4 text-sm text-ink/70 shadow-sm sm:p-6">{apiErrorText(locale, { code: error })} <span className="font-mono text-xs text-ink/45">{error}</span></section>;
  }

  return (
    <section className="mt-6 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><MessageCircle size={18} className="text-[#25d366]" aria-hidden="true" />{t("learn.title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink/60">{t("learn.description")}</p>
        </div>
        <div className="flex flex-wrap gap-2 lg:w-80 lg:shrink-0 lg:flex-col lg:items-stretch">
          <span className="inline-flex items-center gap-2 rounded-md bg-mist/50 px-3 py-2 text-sm text-ink/70">
            <AlarmClock size={16} aria-hidden="true" />{reminderTime ? t("learn.reminder", { time: reminderTime }) : t("learn.noReminder")}
          </span>
          {usage?.limit ? (
            <span className="inline-flex items-center rounded-md bg-mist/50 px-3 py-2 text-sm text-ink/70">
              {t("learn.remaining", { remaining: usage.remaining ?? 0, limit: usage.limit })}
            </span>
          ) : null}
        </div>
      </div>

      {linked === false ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 rounded-md bg-mist/50 px-3 py-2 text-sm text-ink/70">
          <Smartphone size={16} aria-hidden="true" />{t("learn.notLinked")}
          <Link href="/settings/connections" className="font-semibold text-lagoon hover:underline">{t("learn.linkNow")}</Link>
        </p>
      ) : null}

      <div ref={chat} className="mt-4 flex h-[28rem] flex-col gap-3 overflow-y-auto rounded-lg bg-mist/40 p-3 sm:p-4" aria-live="polite">
        {messages.length === 0 && !busy ? <p className="m-auto text-sm text-ink/50">{t("learn.empty")}</p> : null}
        {messages.map((m, i) => (
          <div key={`${m.at}-${i}`} className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-sm leading-6 ${m.direction === "in" ? "self-end rounded-br-sm bg-lagoon text-white" : "self-start rounded-bl-sm border border-ink/10 bg-white text-ink"}`}>
            <Rich text={m.text} />
            <span className={`mt-1 block text-[0.7rem] ${m.direction === "in" ? "text-white/70" : "text-ink/40"}`}>{channelLabel(m.channel)}</span>
            {m === lastOut && m.interactive?.options.length && !busy ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {m.interactive.options.map((o) => <button key={o.id} type="button" onClick={() => send(o.id)} className="rounded-full border border-lagoon/40 bg-white px-3 py-1 text-xs font-semibold text-lagoon hover:bg-lagoon/10">{o.title}</button>)}
              </div>
            ) : null}
          </div>
        ))}
        {busy ? <div className="inline-flex items-center gap-2 self-start text-sm text-ink/55"><Loader2 size={16} className="animate-spin" aria-hidden="true" />{t("learn.thinking")}</div> : null}
      </div>

      {usage?.limit && usage.remaining === 0 ? <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">{t("learn.limitReached", { limit: usage.limit })}</p> : null}
      {error && messages.length > 0 ? <p className="mt-2 text-sm text-coral">{error === "learn.error" ? t("learn.error") : apiErrorText(locale, { code: error })}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((s) => <button key={s} type="button" disabled={busy} onClick={() => send(s)} className="rounded-full border border-ink/15 px-3 py-1 text-sm text-ink/70 hover:border-lagoon/40 hover:text-lagoon">{s}</button>)}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={t("learn.placeholder")} aria-label={t("learn.placeholder")} className="min-h-11 flex-1 rounded-md border border-ink/15 px-3 text-sm" />
        <button type="submit" disabled={busy || !text.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-lagoon px-4 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}{t("st.send")}
        </button>
      </form>
    </section>
  );
}
