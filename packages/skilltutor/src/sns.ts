import { createVerify } from "node:crypto";

export interface SnsEnvelope {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string;
  Token?: string;
}

const CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const certCache = new Map<string, string>();

/** Builds the canonical string-to-sign defined by Amazon SNS. */
export function stringToSign(m: SnsEnvelope): string {
  const keys =
    m.Type === "Notification"
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return keys
    .filter((k) => (m as unknown as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${k}\n${(m as unknown as Record<string, string>)[k]}\n`)
    .join("");
}

/** Verifies an SNS HTTPS delivery came from AWS (certificate host check + RSA signature). */
export async function verifySnsMessage(m: SnsEnvelope): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(m.SigningCertURL);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || !CERT_HOST.test(url.hostname) || !url.pathname.endsWith(".pem")) return false;
  let pem = certCache.get(url.href);
  if (!pem) {
    const res = await fetch(url.href);
    if (!res.ok) return false;
    pem = await res.text();
    certCache.set(url.href, pem);
  }
  const verifier = createVerify(m.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1");
  verifier.update(stringToSign(m), "utf8");
  return verifier.verify(pem, m.Signature, "base64");
}

/** Confirms an SNS subscription by visiting SubscribeURL (only on an AWS host). */
export async function confirmSubscription(m: SnsEnvelope): Promise<void> {
  if (!m.SubscribeURL) return;
  const u = new URL(m.SubscribeURL);
  if (!CERT_HOST.test(u.hostname)) throw new Error("Refusing to confirm non-AWS SubscribeURL");
  await fetch(u.href);
}
