import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { tr, type TutorLocale } from "../i18n";

export async function sendEmail(config: { region: string; from: string; configurationSet: string }, to: string, subject: string, html: string, text: string) {
  const client = new SESv2Client({ region: config.region });
  const r = await client.send(new SendEmailCommand({
    FromEmailAddress: config.from,
    Destination: { ToAddresses: [to] },
    ConfigurationSetName: config.configurationSet || undefined,
    Content: { Simple: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Html: { Data: html, Charset: "UTF-8" }, Text: { Data: text, Charset: "UTF-8" } } } },
    EmailTags: [{ Name: "app", Value: "skilltutor" }],
  }));
  return r.MessageId;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** Branded HTML layout (OMS lagoon colour). */
export function emailLayout(title: string, paragraphs: string[], cta?: { label: string; url: string }, locale: TutorLocale = "vi") {
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.55">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const button = cta ? `<p><a href="${esc(cta.url)}" style="display:inline-block;background:#0e7c86;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(cta.label)}</a></p>` : "";
  return `<!doctype html><html lang="${locale}"><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:24px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:10px;padding:24px;color:#16212b">
<div style="font-size:13px;color:#0e7c86;font-weight:bold;margin-bottom:8px">OpenMatrix Skill · SkillTutor</div><h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>${body}${button}
<p style="font-size:12px;color:#6b7785;margin-top:24px">${esc(tr(locale, "email.footer"))}</p></div></body></html>`;
}
