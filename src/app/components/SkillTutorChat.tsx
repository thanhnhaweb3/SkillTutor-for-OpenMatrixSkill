"use client";

import { ArrowRight, BookOpen, CheckCircle2, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAcAuth } from "@openmatrix/oms-ac-login/react/hooks/useAcAuth";
import { useI18n } from "../../i18n/LocaleProvider";
import type { MessageKey } from "../../i18n/messages";
import { RichText } from "./RichText";

interface Option { id: string; title: string }
interface Msg { at: string; direction: "in" | "out"; text: string; interactive?: { options: Option[] } }
interface Usage { used: number; limit: number; remaining: number | null }
interface AssistantInfo { enabled: boolean; engine: "bedrock" | "mock"; model: string | null }
type Phase = "idle" | "loading" | "ready" | "guest" | "disabled";

/** SkillTutor AI has its own conversation (Claude on Bedrock); "Learn on the web" is the WhatsApp thread. */
const API = "/api/skilltutor/assistant/chat";
const TEASER_KEY = "st-chat-teaser-dismissed";

const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } }
};

function Avatar({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "size-8" : "size-10";
  return (
    <span className={`relative grid ${box} shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-brand-deep text-white shadow-sm`}>
      <Sparkles className={size === "sm" ? "!size-4" : "!size-5"} aria-hidden="true" />
      <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white bg-emerald-500" aria-hidden="true" />
    </span>
  );
}

/**
 * Floating SkillTutor chat (bottom-right on every page). Signed-in learners talk to the same agent as on
 * WhatsApp (POST /api/skilltutor/learn → Claude on Amazon Bedrock with OMS tools); guests see what the bot does and a sign-in button.
 */
export function SkillTutorChat() {
  const pathname = usePathname() ?? "/";
  const { t: raw } = useI18n();
  const t = useCallback((key: MessageKey, params: Record<string, string> = {}) =>
    raw(key).replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? ""), [raw]);
  const { status, user } = useAcAuth();

  const [info, setInfo] = useState<AssistantInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notMember, setNotMember] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);


  useEffect(() => {
    fetch("/api/skilltutor/assistant").then((r) => (r.ok ? r.json() : null)).then((b) => setInfo(b)).catch(() => setInfo(null));
  }, []);

  // Friendly "ready to chat" card, once per browser session.
  useEffect(() => {
    if (!info?.enabled || open || store.get(TEASER_KEY)) return;
    const id = window.setTimeout(() => setTeaser(true), 1500);
    return () => window.clearTimeout(id);
  }, [info?.enabled, open]);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const res = await fetch(API, { cache: "no-store" });
      if (res.status === 401) { setPhase("guest"); return; }
      if (res.status === 503) { setPhase("disabled"); return; }
      const body = await res.json();
      setMessages(((body.messages ?? []) as Msg[]).slice(-40));
      setUsage(body.usage ?? null);
      setPhase("ready");
    } catch { setError(t("chat.error")); setPhase("ready"); }
  }, [t]);

  // Start over when the visitor signs in or out.
  useEffect(() => { setPhase("idle"); setMessages([]); setNotMember(false); setUsage(null); }, [status]);
  // Load history the first time a signed-in user opens the chat.
  useEffect(() => {
    if (!open || status === "loading" || phase !== "idle") return;
    if (status !== "authenticated") setPhase("guest");
    else void load();
  }, [open, status, phase, load]);

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [messages.length, busy, open]);
  useEffect(() => { if (open && phase === "ready") input.current?.focus(); }, [open, phase]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); launcher.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function dismissTeaser() { setTeaser(false); store.set(TEASER_KEY, "1"); }
  function toggle() { dismissTeaser(); setOpen((o) => !o); }

  async function send(body: string) {
    const msg = body.trim();
    if (!msg || busy) return;
    setBusy(true); setText(""); setError(null);
    setMessages((m) => [...m, { at: new Date().toISOString(), direction: "in", text: msg }]);
    try {
      const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: msg }) });
      const b = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessages((m) => [...m, { at: new Date().toISOString(), direction: "out", text: b.reply ?? "", interactive: b.interactive }]);
        if (b.usage) setUsage(b.usage);
        setNotMember(false);
      } else if (b.error?.code === "NOT_MEMBER") setNotMember(true);
      else if (res.status === 401) setPhase("guest");
      else {
        // Show the server's error code (or the HTTP status, e.g. 504 = timed out) so problems can be traced in the Vercel logs.
        const code = b.error?.code ?? (res.status === 504 ? "TIMEOUT" : `HTTP ${res.status}`);
        setError(`${t("chat.error")} (${code}${b.error?.requestId ? ` · ${b.error.requestId}` : ""})`);
      }
    } catch { setError(`${t("chat.error")} (NETWORK)`); }
    finally { setBusy(false); }
  }

  if (!info?.enabled) return null;

  const loginUrl = `/api/ac/auth/login?returnUrl=${encodeURIComponent(pathname)}`;
  const lastOut = [...messages].reverse().find((m) => m.direction === "out");
  const firstName = user?.name?.trim() || user?.email?.split("@")[0] || "";
  const suggestions = (["chat.s1", "chat.s2", "chat.s3", "chat.s4"] as const).map((k) => t(k));
  const footer = info.engine === "bedrock" ? t("chat.poweredBy", { model: info.model ?? "Claude" }) : t("chat.demo");

  return (
    <>
      {teaser && !open ? (
        <div role="status" className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(4.75rem+env(safe-area-inset-right))] z-40 w-[min(19rem,calc(100vw-6rem))] rounded-2xl border border-ink/10 bg-white p-4 text-ink shadow-xl sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:right-[calc(5.25rem+env(safe-area-inset-right))]">
          <button type="button" onClick={dismissTeaser} aria-label={t("chat.dismiss")} title={t("chat.dismiss")} className="absolute right-2 top-2 grid size-7 place-items-center rounded-full text-ink/45 hover:bg-mist hover:text-ink">
            <X className="!size-4" aria-hidden="true" />
          </button>
          <div className="flex items-center gap-3 pr-6">
            <Avatar size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">{t("chat.name")}</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">{t("chat.online")}</p>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-ink/75">{t("chat.teaser")}</p>
          <button type="button" onClick={toggle} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline dark:text-[#8ab8ff]">
            {t("chat.teaserCta")}<ArrowRight className="!size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {open ? (
        <section role="dialog" aria-modal="false" aria-label={t("chat.name")}
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-50 flex h-[min(36rem,calc(100dvh-6.5rem))] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white text-ink shadow-2xl sm:bottom-[calc(5.25rem+env(safe-area-inset-bottom))] sm:right-[calc(1.5rem+env(safe-area-inset-right))] sm:w-[24rem]">
          <header className="flex items-center gap-3 bg-gradient-to-r from-brand to-brand-deep px-4 py-3 text-white">
            <Avatar />
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-tight">{t("chat.name")}</p>
              <p className="flex items-center gap-1.5 text-xs text-white/85">
                <span className={`size-2 rounded-full ${phase === "disabled" ? "bg-white/50" : "bg-emerald-400"}`} aria-hidden="true" />
                {phase === "disabled" ? t("chat.offline") : t("chat.online")}
              </p>
            </div>
            <button type="button" onClick={() => { setOpen(false); launcher.current?.focus(); }} aria-label={t("chat.close")} title={t("chat.close")} className="grid size-9 place-items-center rounded-full hover:bg-white/15">
              <X className="!size-5" aria-hidden="true" />
            </button>
          </header>

          <div ref={list} className="flex flex-1 flex-col gap-3 overflow-y-auto bg-mist/40 p-3" aria-live="polite">
            {phase === "loading" || phase === "idle" ? (
              <Loader2 className="m-auto !size-6 animate-spin text-ink/40" aria-hidden="true" />
            ) : phase === "disabled" ? (
              <p className="m-auto text-sm text-ink/60">{t("chat.disabled")}</p>
            ) : phase === "guest" ? (
              <>
                <BotBubble><p>{t("chat.guestIntro")}</p></BotBubble>
                <BotBubble>
                  <ul className="space-y-1.5">
                    {(["chat.guestF1", "chat.guestF2", "chat.guestF3", "chat.guestF4"] as const).map((k) => (
                      <li key={k} className="flex gap-2"><CheckCircle2 className="mt-1 !size-4 shrink-0 text-emerald-600" aria-hidden="true" />{t(k)}</li>
                    ))}
                  </ul>
                </BotBubble>
              </>
            ) : (
              <>
                {messages.length === 0 ? <BotBubble><p>{t("chat.greeting", { name: firstName })}</p><p className="mt-1 text-xs text-ink/50">{t("chat.separate")}</p></BotBubble> : null}
                {messages.map((m, i) => m.direction === "in" ? (
                  <div key={`${m.at}-${i}`} className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-brand px-3.5 py-2 text-sm leading-6 text-white">{m.text}</div>
                ) : (
                  <BotBubble key={`${m.at}-${i}`}>
                    <p className="whitespace-pre-wrap"><RichText text={m.text} /></p>
                    {m === lastOut && m.interactive?.options.length && !busy ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.interactive.options.map((o) => (
                          <button key={o.id} type="button" onClick={() => send(o.id)} className="rounded-full border border-brand/40 bg-white px-3 py-1 text-xs font-semibold text-brand hover:bg-brand-soft dark:text-[#8ab8ff]">{o.title}</button>
                        ))}
                      </div>
                    ) : null}
                  </BotBubble>
                ))}
                {busy ? (
                  <div className="flex items-center gap-2 self-start text-sm text-ink/55"><Loader2 className="!size-4 animate-spin" aria-hidden="true" />{t("chat.thinking")}</div>
                ) : null}
                {notMember ? (
                  <BotBubble>
                    <p>{t("chat.notMember")}</p>
                    <Link href="/#courses" onClick={() => setOpen(false)} className="mt-2 inline-flex items-center gap-1.5 font-semibold text-brand hover:underline dark:text-[#8ab8ff]">
                      <BookOpen className="!size-4" aria-hidden="true" />{t("chat.browseCourses")}
                    </Link>
                  </BotBubble>
                ) : null}
              </>
            )}
          </div>

          {phase === "ready" ? (
            <div className="border-t border-ink/10 p-3">
              {messages.length === 0 && !busy ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-ink/15 px-3 py-1 text-xs text-ink/70 hover:border-brand/50 hover:text-brand dark:hover:text-[#8ab8ff]">{s}</button>
                  ))}
                </div>
              ) : null}
              {error ? <p className="mb-2 text-xs text-coral">{error}</p> : null}
              {usage?.limit && usage.remaining === 0 ? (
                <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">{t("chat.limitReached", { limit: String(usage.limit) })}</p>
              ) : null}
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
                <input ref={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={t("chat.placeholder")} aria-label={t("chat.placeholder")}
                  className="min-h-10 min-w-0 flex-1 rounded-full border border-ink/15 bg-transparent px-4 text-sm focus:border-brand focus:outline-none" />
                <button type="submit" disabled={busy || !text.trim()} aria-label={t("chat.send")} title={t("chat.send")} className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-white hover:bg-brand-deep disabled:opacity-40">
                  {busy ? <Loader2 className="!size-4 animate-spin" aria-hidden="true" /> : <Send className="!size-4" aria-hidden="true" />}
                </button>
              </form>
            </div>
          ) : phase === "guest" ? (
            <div className="border-t border-ink/10 p-3">
              <a href={loginUrl} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-deep">
                {t("chat.signIn")}<ArrowRight className="!size-4" aria-hidden="true" />
              </a>
            </div>
          ) : null}
          <p className="flex flex-wrap justify-center gap-x-3 border-t border-ink/5 px-3 py-1.5 text-center text-[0.7rem] text-ink/45">
            <span>{footer}</span>
            {phase === "ready" && usage?.limit ? <span>{t("chat.remaining", { remaining: String(usage.remaining ?? 0), limit: String(usage.limit) })}</span> : null}
          </p>
        </section>
      ) : null}

      <button ref={launcher} type="button" onClick={toggle} aria-expanded={open} aria-label={open ? t("chat.close") : t("chat.open")} title={open ? t("chat.close") : t("chat.open")}
        className="relative grid size-14 place-items-center rounded-full bg-gradient-to-br from-brand to-brand-deep text-white shadow-xl transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2 dark:ring-offset-slate-900">
        {open ? <X className="!size-6" aria-hidden="true" /> : <MessageCircle className="!size-6" aria-hidden="true" />}
        {!open ? <span className="absolute right-0.5 top-0.5 size-3.5 rounded-full border-2 border-white bg-emerald-500" aria-hidden="true" /> : null}
      </button>
    </>
  );
}

function BotBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-w-[92%] items-end gap-2 self-start">
      <Avatar size="sm" />
      <div className="min-w-0 break-words rounded-2xl rounded-bl-sm border border-ink/10 bg-white px-3.5 py-2 text-sm leading-6 text-ink">{children}</div>
    </div>
  );
}
