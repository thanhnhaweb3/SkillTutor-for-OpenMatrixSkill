import { createHash, randomBytes } from "node:crypto";
import type { SkillTutorRuntime } from "./runtime";
import { newId } from "./store";
import type { TutorCertificate } from "./types";

export function certificateHash(c: Omit<TutorCertificate, "hash">): string {
  const canonical = JSON.stringify([c.code, c.userId, c.learnerName, c.expertId, c.courseId, c.courseVersionId,
    c.skills.map((s) => [s.skillId, s.proficiency]), c.score, c.issuedAt]);
  return createHash("sha256").update(canonical).digest("hex");
}

export async function issueCertificate(rt: SkillTutorRuntime, input: Omit<TutorCertificate, "code" | "issuedAt" | "hash">) {
  const base = { ...input, code: `OMS-${randomBytes(4).toString("hex").toUpperCase()}`, issuedAt: rt.now().toISOString() };
  const cert: TutorCertificate = { ...base, hash: certificateHash(base) };
  await rt.store.putCertificate(cert);
  await rt.store.addEvent({ id: newId(), at: cert.issuedAt, type: "certificate_issued", userId: cert.userId, expertId: cert.expertId, data: { code: cert.code, courseId: cert.courseId } });
  return cert;
}

export const verifyUrl = (rt: SkillTutorRuntime, code: string) => `${rt.config.appUrl.replace(/\/$/, "")}/verify/${code}`;

export async function verifyCertificate(rt: SkillTutorRuntime, code: string) {
  const cert = await rt.store.getCertificate(code.trim().toUpperCase());
  if (!cert) return { valid: false as const, cert: null };
  const { hash, ...rest } = cert;
  return { valid: certificateHash(rest) === hash, cert };
}
