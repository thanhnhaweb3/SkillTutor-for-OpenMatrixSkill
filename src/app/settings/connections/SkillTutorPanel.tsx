"use client";

import { BadgeCheck, Loader2, MessageCircle, Unlink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../../i18n/LocaleProvider";
import { pickLang } from "@openmatrix/skilltutor/bilingual";

interface LinkStatus {
  linked: boolean;
  phone?: string;
  channel?: "whatsapp" | "sms";
  whatsappNumber?: string;
  smsNumber?: string;
  certificates: { code: string; courseTitle: string; expertName: string; skills: { name: string; proficiency: string }[]; score: number; issuedAt: string }[];
}
interface LinkCode { code: string; expiresAt: string; message: string; whatsappUrl?: string; whatsappNumber?: string; smsNumber?: string }

const copy = {
  vi: {
    title: "SkillTutor trên WhatsApp & SMS",
    description: "Học bài 5 phút, ghi tiến độ và thi lấy chứng chỉ kỹ năng ngay trong WhatsApp. Tiến độ được ghi thẳng vào khóa học OMS của bạn.",
    linkedAs: "Đã liên kết",
    link: "Liên kết WhatsApp",
    unlink: "Hủy liên kết",
    send: "Gửi tin nhắn này từ điện thoại của bạn",
    to: "tới",
    openWhatsApp: "Mở WhatsApp",
    expires: "Mã hết hạn lúc",
    waiting: "Đang chờ tin nhắn…",
    certificates: "Chứng chỉ kỹ năng",
    none: "Chưa có chứng chỉ. Hoàn thành khóa học và thi qua SkillTutor để nhận chứng chỉ.",
    verify: "Xác minh",
    error: "Không thể tải SkillTutor. Thử lại sau."
  },
  en: {
    title: "SkillTutor on WhatsApp & SMS",
    description: "Take 5-minute lessons, record progress and earn skill certificates inside WhatsApp. Progress goes straight into your OMS course.",
    linkedAs: "Linked",
    link: "Link WhatsApp",
    unlink: "Unlink",
    send: "Send this message from your phone",
    to: "to",
    openWhatsApp: "Open WhatsApp",
    expires: "Code expires at",
    waiting: "Waiting for your message…",
    certificates: "Skill certificates",
    none: "No certificates yet. Finish a course and pass the SkillTutor quiz to earn one.",
    verify: "Verify",
    error: "SkillTutor could not be loaded. Try again later."
  }
} as const;

const json = { "content-type": "application/json" };

export function SkillTutorPanel() {
  const { locale } = useI18n();
  const lang = (text: string) => pickLang(text, locale);
  const c = copy[locale];
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "hidden" | "error">("loading");
  const [code, setCode] = useState<LinkCode | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/skilltutor/link", { cache: "no-store" });
    if (res.status === 503 || res.status === 401) { setState("hidden"); return null; }
    if (!res.ok) { setState("error"); return null; }
    const body = (await res.json()) as LinkStatus;
    setStatus(body);
    setState("ready");
    return body;
  }, []);

  useEffect(() => { void load().catch(() => setState("error")); }, [load]);

  useEffect(() => {
    if (!code) return;
    const timer = setInterval(async () => {
      const body = await load().catch(() => null);
      if (body?.linked) { setCode(null); clearInterval(timer); }
    }, 4000);
    return () => clearInterval(timer);
  }, [code, load]);

  async function startLink() {
    setBusy(true);
    try {
      const res = await fetch("/api/skilltutor/link", { method: "POST", headers: json, body: "{}" });
      if (res.ok) setCode((await res.json()) as LinkCode);
    } finally { setBusy(false); }
  }
  async function removeLink() {
    setBusy(true);
    try { await fetch("/api/skilltutor/link", { method: "DELETE", headers: json, body: "{}" }); await load(); } finally { setBusy(false); }
  }

  if (state === "hidden") return null;
  return (
    <section className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-lagoon/10 text-lagoon"><MessageCircle aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-ink">{c.title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink/65">{c.description}</p>

          {state === "loading" ? <Loader2 className="mt-4 animate-spin text-lagoon" aria-hidden="true" /> : null}
          {state === "error" ? <p className="mt-4 text-sm text-coral">{c.error}</p> : null}

          {state === "ready" && status ? (
            <div className="mt-4 flex flex-col gap-4">
              {status.linked ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <span className="inline-flex items-center gap-2 rounded-md bg-lagoon/10 px-3 py-2 text-sm font-semibold text-lagoon">
                    <BadgeCheck size={18} aria-hidden="true" /> {c.linkedAs}: {status.phone} ({status.channel === "sms" ? "SMS" : "WhatsApp"})
                  </span>
                  <button type="button" disabled={busy} onClick={removeLink} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-ink/15 px-4 py-2 text-sm font-semibold text-ink/70 sm:ml-auto">
                    <Unlink size={16} aria-hidden="true" /> {c.unlink}
                  </button>
                </div>
              ) : code ? (
                <div className="rounded-lg border border-lagoon/30 bg-lagoon/5 p-4">
                  <p className="text-sm text-ink/70">{c.send}{code.whatsappNumber ? ` ${c.to} ${code.whatsappNumber}` : ""}{code.smsNumber ? ` / SMS ${code.smsNumber}` : ""}:</p>
                  <p className="mt-2 font-mono text-3xl font-semibold tracking-widest text-ink">{code.message}</p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    {code.whatsappUrl ? (
                      <a href={code.whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white">{c.openWhatsApp}</a>
                    ) : null}
                    <span className="inline-flex items-center gap-2 text-sm text-ink/55"><Loader2 size={16} className="animate-spin" aria-hidden="true" />{c.waiting}</span>
                    <span className="text-sm text-ink/45 sm:ml-auto">{c.expires} {new Date(code.expiresAt).toLocaleTimeString(locale === "en" ? "en-GB" : "vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={busy} onClick={startLink} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white sm:w-auto sm:self-start">
                  <MessageCircle size={18} aria-hidden="true" /> {c.link}
                </button>
              )}

              <div className="border-t border-ink/10 pt-4">
                <h3 className="font-semibold text-ink">{c.certificates}</h3>
                {status.certificates.length === 0 ? <p className="mt-1 text-sm text-ink/55">{c.none}</p> : (
                  <ul className="mt-2 flex flex-col gap-2">
                    {status.certificates.map((cert) => (
                      <li key={cert.code} className="flex flex-col gap-1 rounded-lg border border-ink/10 p-3 sm:flex-row sm:items-center sm:gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">{lang(cert.courseTitle)} <span className="font-normal text-ink/55">· {cert.expertName}</span></p>
                          <p className="text-sm text-ink/60">{cert.skills.map((s) => `${lang(s.name)} (${s.proficiency})`).join(", ")} · {Math.round(cert.score * 100)}%</p>
                        </div>
                        <a href={`/verify/${cert.code}`} className="font-mono text-sm font-semibold text-lagoon sm:ml-auto">{cert.code} · {c.verify}</a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
