"use client";

import { Check, Copy, Loader2, ShieldCheck, UserMinus, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiErrorText, type MessageKey } from "../../../../i18n/messages";
import { useT } from "../useT";
import { pickLang } from "@openmatrix/skilltutor/bilingual";

interface Cohort { id: string; name: string; status: string; startDate: string; courseTitle: string; lessonCount: number }
interface RosterRow { userId: string; name: string; email?: string; enrolledAt: string; percentComplete: number; completedLessonCount: number; requiredLessonCount: number; channel?: string; certificate?: string }
interface JoinRequest { userId: string; name: string; email?: string; note?: string; requestedAt: string; status: "pending" | "approved" | "rejected" }
interface AdminData { cohorts: Cohort[]; cohortId?: string; joinUrl?: string; roster: RosterRow[]; requests: JoinRequest[] }
interface AdmitResult { email: string; name?: string; status: string }
interface TeamMember { userId: string; name: string; email?: string; roles: string[] }
interface TeamData { selfUserId: string; roles: string[]; members: TeamMember[] }

export default function LearnersAdminPage() {
  const { t, locale } = useT();
  const lang = (text: string) => pickLang(text, locale);
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cohortId, setCohortId] = useState<string>("");
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<AdmitResult[]>([]);
  const [copied, setCopied] = useState(false);
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale === "en" ? "en-GB" : "vi-VN");

  const load = useCallback(async (id?: string) => {
    const res = await fetch(`/api/skilltutor/admin/learners${id ? `?cohortId=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setError(body.error?.code ?? "INTERNAL_ERROR"); return; }
    setError(null);
    setData(body);
    setCohortId(body.cohortId ?? "");
  }, []);

  useEffect(() => { void load().catch(() => setError("INTERNAL_ERROR")); }, [load]);

  async function post(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const res = await fetch("/api/skilltutor/admin/learners", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cohortId, ...payload }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error?.code ?? "INTERNAL_ERROR"); return null; }
      await load(cohortId);
      return body;
    } finally { setBusy(null); }
  }

  async function admit(e: React.FormEvent) {
    e.preventDefault();
    const list = emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) return;
    const body = await post({ action: "admit", emails: list.slice(0, 50) }, "admit");
    if (body?.results) {
      setResults(body.results);
      setEmails(body.results.filter((r: AdmitResult) => !["enrolled", "already_enrolled"].includes(r.status)).map((r: AdmitResult) => r.email).join("\n"));
    }
  }

  async function copyLink() {
    if (!data?.joinUrl) return;
    await navigator.clipboard?.writeText(data.joinUrl).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (error === "MISSING_PERMISSION" || error === "NOT_MEMBER") {
    return <section className="mt-6 rounded-xl border border-ink/10 bg-white p-6 text-sm text-ink/70 shadow-sm">{t("learners.forbidden")}</section>;
  }

  const pending = data?.requests.filter((r) => r.status === "pending") ?? [];
  const decided = data?.requests.filter((r) => r.status !== "pending").slice(0, 10) ?? [];

  return (
    <div className="mt-6 grid gap-6">
      <section className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-ink">{t("learners.title")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink/60">{t("learners.description")}</p>
        {error ? <p className="mt-4 text-sm text-coral">{apiErrorText(locale, { code: error })}</p> : null}
        {!data && !error ? <Loader2 className="mt-4 animate-spin text-lagoon" aria-hidden="true" /> : null}
        {data && data.cohorts.length === 0 ? <p className="mt-4 rounded-lg bg-mist/40 p-4 text-sm text-ink/60">{t("learners.noCohort")}</p> : null}
        {data && data.cohorts.length > 0 ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <label className="grid min-w-0 gap-1 text-sm font-semibold text-ink">
              {t("learners.cohort")}
              {/* Long course + cohort names: the select must not size itself to its widest option and overflow the card. */}
              <select value={cohortId} onChange={(e) => { setResults([]); void load(e.target.value); }} className="min-h-11 w-full min-w-0 max-w-full truncate rounded-md border border-ink/15 bg-white px-3 pr-8 font-normal">
                {data.cohorts.map((c) => <option key={c.id} value={c.id}>{lang(c.courseTitle)} · {lang(c.name)}{c.status !== "active" ? ` (${c.status})` : ""}</option>)}
              </select>
              {(() => { const c = data.cohorts.find((x) => x.id === cohortId); return c ? (
                <span className="text-xs font-normal text-ink/55">{lang(c.courseTitle)} · {lang(c.name)} · {date(c.startDate)}</span>
              ) : null; })()}
            </label>
            {data.joinUrl ? (
              <div className="grid min-w-0 gap-1 text-sm">
                <span className="font-semibold text-ink">{t("learners.joinLink")}</span>
                <div className="flex gap-2">
                  <input readOnly value={data.joinUrl} aria-label={t("learners.joinLink")} className="min-h-11 min-w-0 flex-1 rounded-md border border-ink/15 bg-mist/30 px-3 font-mono text-xs" />
                  <button type="button" onClick={copyLink} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-lagoon/40 px-3 font-semibold text-lagoon">
                    {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? t("learners.copied") : t("learners.copy")}
                  </button>
                </div>
                <span className="text-xs text-ink/55">{t("learners.joinHint")}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {data && data.cohorts.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
            <h3 className="font-semibold text-ink">{t("learners.requests")} {pending.length ? <span className="ml-1 rounded-full bg-saffron/30 px-2 py-0.5 text-xs">{pending.length}</span> : null}</h3>
            {pending.length === 0 ? <p className="mt-3 text-sm text-ink/55">{t("learners.noRequests")}</p> : null}
            <ul className="mt-3 grid gap-2">
              {pending.map((r) => (
                <li key={r.userId} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{r.name}</p>
                    <p className="truncate text-xs text-ink/55">{r.email} · {date(r.requestedAt)}</p>
                    {r.note ? <p className="mt-1 text-sm text-ink/70">“{r.note}”</p> : null}
                  </div>
                  <button type="button" disabled={!!busy} onClick={() => void post({ action: "approve", userId: r.userId }, r.userId)} className="inline-flex min-h-10 items-center gap-1 rounded-md bg-lagoon px-3 text-sm font-semibold text-white disabled:opacity-60">
                    {busy === r.userId ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{t("learners.approve")}
                  </button>
                  <button type="button" disabled={!!busy} onClick={() => void post({ action: "reject", userId: r.userId }, `x-${r.userId}`)} className="inline-flex min-h-10 items-center gap-1 rounded-md border border-coral/40 px-3 text-sm font-semibold text-coral disabled:opacity-60">
                    <X size={14} aria-hidden="true" />{t("learners.reject")}
                  </button>
                </li>
              ))}
            </ul>
            {decided.length ? (
              <ul className="mt-4 grid gap-1 border-t border-ink/10 pt-3 text-xs text-ink/55">
                {decided.map((r) => <li key={r.userId}>{r.name} · {t(`learners.status.${r.status}` as MessageKey)}</li>)}
              </ul>
            ) : null}
          </section>

          <section className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
            <h3 className="font-semibold text-ink">{t("learners.addTitle")}</h3>
            <p className="mt-1 text-xs text-ink/55">{t("learners.addHint")}</p>
            <form onSubmit={admit} className="mt-3 grid gap-2">
              <textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={4} placeholder={"hocvien1@congty.vn\nhocvien2@congty.vn"} aria-label={t("learners.addTitle")} className="rounded-md border border-ink/15 p-3 font-mono text-sm" />
              <button type="submit" disabled={!!busy || !emails.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-lagoon px-4 text-sm font-semibold text-white disabled:opacity-60">
                {busy === "admit" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />}{t("learners.addSubmit")}
              </button>
            </form>
            {results.length ? (
              <ul className="mt-3 grid gap-1 text-sm">
                {results.map((r) => (
                  <li key={r.email} className={["enrolled", "already_enrolled"].includes(r.status) ? "text-lagoon" : "text-coral"}>
                    {r.name ? `${r.name} · ` : ""}{r.email}: {t(`learners.result.${r.status}` as MessageKey)}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      ) : null}

      {data && data.cohorts.length > 0 ? (
        <section className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
          <h3 className="font-semibold text-ink">{t("learners.roster", { count: data.roster.length })}</h3>
          {data.roster.length === 0 ? <p className="mt-3 text-sm text-ink/55">{t("learners.empty")}</p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase text-ink/50">
                  <tr><th className="py-2 pr-3">{t("learners.colLearner")}</th><th className="py-2 pr-3">{t("learners.colProgress")}</th><th className="py-2 pr-3">{t("learners.colChannel")}</th><th className="py-2 pr-3">{t("learners.colCertificate")}</th><th className="py-2">{t("learners.colEnrolled")}</th></tr>
                </thead>
                <tbody>
                  {data.roster.map((r) => (
                    <tr key={r.userId} className="border-t border-ink/10">
                      <td className="py-2 pr-3"><p className="font-semibold text-ink">{r.name}</p><p className="text-xs text-ink/55">{r.email}</p></td>
                      <td className="py-2 pr-3">
                        <div className="h-2 w-28 rounded-full bg-mist"><div className="h-2 rounded-full bg-lagoon" style={{ width: `${r.percentComplete}%` }} /></div>
                        <span className="text-xs text-ink/60">{r.completedLessonCount}/{r.requiredLessonCount} · {r.percentComplete}%</span>
                      </td>
                      <td className="py-2 pr-3 capitalize text-ink/70">{r.channel ?? t("learners.webOnly")}</td>
                      <td className="py-2 pr-3">{r.certificate ? <a href={`/verify/${r.certificate}`} target="_blank" rel="noreferrer" className="font-mono text-xs font-semibold text-lagoon">{r.certificate}</a> : <span className="text-ink/40">–</span>}</td>
                      <td className="py-2 text-ink/60">{date(r.enrolledAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {data ? <TeamSection /> : null}
    </div>
  );
}

/** Expert team: approve an account as Expert staff by email (e.g. hackathon judges) and remove it again. */
function TeamSection() {
  const { t, locale } = useT();
  const [team, setTeam] = useState<TeamData | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("reviewer");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/skilltutor/admin/team", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setTeam(body);
    else setMessage({ ok: false, text: apiErrorText(locale, body.error) });
  }, [locale]);
  useEffect(() => { void load().catch(() => undefined); }, [load]);

  async function post(payload: Record<string, unknown>, key: string, label?: string) {
    setBusy(key); setMessage(null);
    try {
      const res = await fetch("/api/skilltutor/admin/team", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage({ ok: false, text: apiErrorText(locale, body.error) }); return null; }
      setMessage({ ok: ["added", "removed"].includes(body.status), text: `${label ?? body.name ?? body.email ?? ""}: ${t(`team.result.${body.status}` as MessageKey)}` });
      await load();
      return body;
    } finally { setBusy(null); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    const body = await post({ action: "add", email: email.trim(), role }, "add");
    if (body?.status === "added" || body?.status === "already_member") setEmail("");
  }

  function remove(m: TeamMember) {
    if (!window.confirm(t("team.confirmRemove", { name: m.name }))) return;
    void post({ action: "remove", userId: m.userId }, m.userId, m.name);
  }

  return (
    <section className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
      <h3 className="flex items-center gap-2 font-semibold text-ink"><ShieldCheck size={18} className="text-lagoon" aria-hidden="true" />{t("team.title")}</h3>
      <p className="mt-1 max-w-3xl text-xs text-ink/55">{t("team.description")}</p>
      <form onSubmit={add} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="giamkhao@hackathon.vn" aria-label={t("team.email")} className="min-h-11 rounded-md border border-ink/15 px-3 text-sm" />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label={t("team.role")} className="min-h-11 rounded-md border border-ink/15 bg-white px-3 text-sm">
          {(team?.roles ?? ["reviewer"]).map((r) => <option key={r} value={r}>{t(`team.role.${r}` as MessageKey)}</option>)}
        </select>
        <button type="submit" disabled={!!busy || !email.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-lagoon px-4 text-sm font-semibold text-white disabled:opacity-60">
          {busy === "add" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />}{t("team.add")}
        </button>
      </form>
      {message ? <p role="status" className={`mt-2 text-sm ${message.ok ? "text-lagoon" : "text-coral"}`}>{message.text}</p> : null}
      {!team ? <Loader2 className="mt-4 animate-spin text-lagoon" aria-hidden="true" /> : team.members.length === 0 ? <p className="mt-3 text-sm text-ink/55">{t("team.empty")}</p> : (
        <ul className="mt-4 grid gap-2">
          {team.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{m.name}{m.userId === team.selfUserId ? <span className="ml-1 text-xs font-normal text-ink/50">({t("team.you")})</span> : null}</p>
                <p className="truncate text-xs text-ink/55">{m.email}</p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {m.roles.map((r) => <li key={r} className="rounded-full bg-mist px-2 py-0.5 text-xs text-ink/70">{t(`team.role.${r}` as MessageKey).split(" – ")[0]}</li>)}
                </ul>
              </div>
              {m.userId !== team.selfUserId && !m.roles.includes("platform_admin") ? (
                <button type="button" disabled={!!busy} onClick={() => remove(m)} className="inline-flex min-h-10 items-center gap-1 rounded-md border border-coral/40 px-3 text-sm font-semibold text-coral disabled:opacity-60">
                  {busy === m.userId ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <UserMinus size={14} aria-hidden="true" />}{t("team.remove")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
