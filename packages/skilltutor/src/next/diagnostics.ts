import { NextRequest, NextResponse } from "next/server";
import type { ExpertContext } from "@openmatrix/dashboard";
import { deliver } from "../channels";
import { tr } from "../i18n";
import { getSkillTutorRuntime, type SkillTutorRuntime } from "../runtime";
import { fail, headers, rid, sameOrigin, sessionUser, signedIn, STAFF_ROLES, type RuntimeProvider, type SessionUserResolver } from "./handlers";

const DAY = 86_400_000;
const WA_EVENTS = new Set(["wa_sent", "wa_failed", "wa_status"]);

type StaffAuth = { error: string; status: number } | { user: { id: string; name: string }; context: ExpertContext };

async function staff(rt: SkillTutorRuntime, resolveUser: SessionUserResolver, request: NextRequest): Promise<StaffAuth> {
  const user = await signedIn(rt, resolveUser, request);
  if (!user) return { error: "UNAUTHENTICATED", status: 401 } as const;
  const context = await rt.gateway.resolveContext({ id: user.id, displayName: user.name });
  if (!context || !context.permissions.includes("report:read") || !context.roles.some((r) => STAFF_ROLES.has(r))) return { error: "MISSING_PERMISSION", status: 403 } as const;
  return { user, context } as const;
}

/**
 * WhatsApp delivery diagnostics for Expert staff:
 * GET  – configuration in use + the latest send results and SNS delivery receipts.
 * POST – sends a test message to the caller's own linked WhatsApp number and returns the AWS result or error.
 */
export function createWhatsAppDiagnosticsHandlers(provider: RuntimeProvider = getSkillTutorRuntime, resolveUser: SessionUserResolver = sessionUser) {
  return {
    GET: async (request: NextRequest) => {
      const requestId = rid(request);
      const rt = await provider();
      if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
      const auth = await staff(rt, resolveUser, request);
      if ("error" in auth) return fail(auth.error, auth.status, requestId);
      const [link, state] = await Promise.all([rt.store.getLinkByUser(auth.user.id), rt.store.getState(auth.user.id)]);
      const events = [];
      for (const e of await rt.store.listEvents(2000)) {
        if (!WA_EVENTS.has(e.type)) continue;
        if (e.userId !== "unknown" && e.userId !== auth.user.id && !(await rt.gateway.isMember(auth.context.expertId, e.userId))) continue;
        events.push({ at: e.at, type: e.type, ...(e.data ?? {}) });
        if (events.length >= 30) break;
      }
      const w = rt.config.whatsapp;
      return NextResponse.json({
        config: { channelsMode: rt.config.channelsMode, metaApiVersion: w.metaApiVersion, phoneNumberIdSet: w.originationPhoneNumberId.startsWith("phone-number-id-"),
          displayNumber: w.displayNumber || null, template: w.nudgeTemplate, templateLanguages: { vi: w.templateLanguage, en: w.templateLanguageEn }, region: rt.config.region },
        me: { linked: link?.channel === "whatsapp", phone: link ? `${link.phone.slice(0, 4)}•••${link.phone.slice(-3)}` : null,
          lastInboundAt: state?.lastWhatsAppInboundAt ?? null,
          inWindow: !!state?.lastWhatsAppInboundAt && Date.now() - new Date(state.lastWhatsAppInboundAt).getTime() < DAY },
        events
      }, { headers: headers(requestId) });
    },
    POST: async (request: NextRequest) => {
      const requestId = rid(request);
      const rt = await provider();
      if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
      if (!sameOrigin(request)) return fail("MISSING_PERMISSION", 403, requestId);
      const auth = await staff(rt, resolveUser, request);
      if ("error" in auth) return fail(auth.error, auth.status, requestId);
      const link = await rt.store.getLinkByUser(auth.user.id);
      if (!link || link.channel !== "whatsapp") return fail("WHATSAPP_NOT_LINKED", 409, requestId);
      const state = await rt.store.getState(auth.user.id);
      const locale = state?.locale === "en" ? "en" : "vi";
      const time = rt.now().toLocaleTimeString(locale === "en" ? "en-GB" : "vi-VN", { timeZone: rt.config.timeZone, hour: "2-digit", minute: "2-digit" });
      try {
        const r = await deliver(rt, auth.user.id, { channel: "whatsapp", to: { phone: link.phone }, text: tr(locale, "wa.test", { time }), locale });
        return NextResponse.json({ ok: true, mode: r.mode, messageId: r.id }, { headers: headers(requestId) });
      } catch (error) {
        const e = error as Error & { $metadata?: { httpStatusCode?: number } };
        return NextResponse.json({ ok: false, error: { name: e.name, message: e.message, http: e.$metadata?.httpStatusCode } }, { status: 200, headers: headers(requestId) });
      }
    }
  };
}
