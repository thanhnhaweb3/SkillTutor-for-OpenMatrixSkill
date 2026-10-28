"use client";

import { Loader2, RefreshCw, Send, Stethoscope } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiErrorText, type MessageKey } from "../../../i18n/messages";
import { useT } from "./useT";

interface Diag {
  config: { channelsMode: string; metaApiVersion: string; phoneNumberIdSet: boolean; displayNumber: string | null; template: string; templateLanguages: { vi: string; en: string }; region: string };
  me: { linked: boolean; phone: string | null; lastInboundAt: string | null; inWindow: boolean };
  events: { at: string; type: string; status?: string; kind?: string; messageId?: string; to?: string; error?: string; http?: number }[];
}

/** Staff-only card on the SkillTutor overview: test send + SNS delivery receipts. */
export function WhatsAppDiagnostics() {
  const { t, locale } = useT();
  const [diag, setDiag] = useState<Diag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "dry" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/skilltutor/admin/whatsapp", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setError(body.error?.code ?? "INTERNAL_ERROR"); return; }
    setError(null);
    setDiag(body);
  }, []);
  useEffect(() => { void load().catch(() => setError("INTERNAL_ERROR")); }, [load]);

  async function sendTest() {
    setBusy(true); setResult(null);
    try {
      const res = await fetch("/api/skilltutor/admin/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = await res.json().catch(() => ({}));
      if (body.error?.code === "WHATSAPP_NOT_LINKED") setResult({ kind: "err", text: t("diag.notLinked") });
      else if (!res.ok) setResult({ kind: "err", text: apiErrorText(locale, body.error) });
      else if (!body.ok) setResult({ kind: "err", text: t("diag.failed", { error: `${body.error?.name}: ${body.error?.message}` }) });
      else if (body.mode === "dryrun") setResult({ kind: "dry", text: t("diag.dryrun") });
      else setResult({ kind: "ok", text: t("diag.sent", { id: body.messageId ?? "?" }) });
      await load();
    } finally { setBusy(false); }
  }

  if (error === "MISSING_PERMISSION") return null;
  const time = (iso: string) => new Date(iso).toLocaleString(locale === "en" ? "en-GB" : "vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit", day: "2-digit", month: "2-digit" });

  return (
    <section className="mt-6 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Stethoscope size={18} aria-hidden="true" />{t("diag.title")}</h2>
          <p className="mt-1 max-w-3xl text-sm text-ink/60">{t("diag.description")}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-ink/15 px-3 text-sm font-semibold text-ink/70"><RefreshCw size={16} aria-hidden="true" />{t("diag.refresh")}</button>
          <button type="button" onClick={sendTest} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-lagoon px-4 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}{t("diag.send")}
          </button>
        </div>
      </div>
      {error ? <p className="mt-3 text-sm text-coral">{apiErrorText(locale, { code: error })}</p> : null}
      {result ? <p className={`mt-3 rounded-md p-3 text-sm ${result.kind === "ok" ? "bg-lagoon/10 text-lagoon" : result.kind === "dry" ? "bg-saffron/20 text-ink" : "bg-coral/10 text-coral"}`}>{result.text}</p> : null}
      {diag && diag.me.linked && !diag.me.inWindow ? <p className="mt-3 rounded-md bg-saffron/20 p-3 text-sm text-ink">{t("diag.window")}</p> : null}

      {diag ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 self-start rounded-lg bg-mist/30 p-3 text-xs">
            <dt className="col-span-2 mb-1 font-semibold text-ink">{t("diag.config")}</dt>
            <dt className="text-ink/55">Channels</dt><dd className="font-mono">{diag.config.channelsMode}</dd>
            <dt className="text-ink/55">Meta API</dt><dd className="font-mono">{diag.config.metaApiVersion}</dd>
            <dt className="text-ink/55">Phone number ID</dt><dd>{diag.config.phoneNumberIdSet ? "✓" : "✗"}</dd>
            <dt className="text-ink/55">Number</dt><dd className="font-mono">{diag.config.displayNumber ?? "–"}</dd>
            <dt className="text-ink/55">Template</dt><dd className="font-mono">{diag.config.template} ({diag.config.templateLanguages.en}/{diag.config.templateLanguages.vi})</dd>
            <dt className="text-ink/55">My WhatsApp</dt><dd className="font-mono">{diag.me.phone ?? "–"}</dd>
            <dt className="text-ink/55">Last inbound</dt><dd>{diag.me.lastInboundAt ? time(diag.me.lastInboundAt) : "–"}</dd>
          </dl>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">{t("diag.events")}</h3>
            {diag.events.length === 0 ? <p className="mt-2 text-sm text-ink/55">{t("diag.noEvents")}</p> : (
              <ul className="mt-2 grid max-h-80 gap-1 overflow-y-auto text-xs">
                {diag.events.map((e, i) => (
                  <li key={`${e.at}-${i}`} className={`rounded-md border p-2 ${e.type === "wa_failed" || e.error ? "border-coral/30 bg-coral/5" : "border-ink/10"}`}>
                    <span className="font-mono text-ink/50">{time(e.at)}</span>{" "}
                    <span className="font-semibold text-ink">{t(`diag.type.${e.type}` as MessageKey)}{e.status ? `: ${e.status}` : ""}{e.kind ? ` (${e.kind})` : ""}</span>{" "}
                    <span className="text-ink/60">{e.to}</span>
                    {e.messageId ? <span className="block truncate font-mono text-ink/40">{e.messageId}</span> : null}
                    {e.error ? <span className="block break-words text-coral">{e.error}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : !error ? <Loader2 className="mt-4 animate-spin text-lagoon" aria-hidden="true" /> : null}
    </section>
  );
}
