import crypto from "node:crypto";
import type { AcUser } from "./types";

export const SESSION_COOKIE = "openmatrix-session";

export interface SessionPayload {
  userId: string;
  user?: AcUser;
  exp: number;
}

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(
  userId: string,
  secret: string,
  maxAgeSec: number,
  user?: AcUser
) {
  const payload: SessionPayload = {
    userId,
    user,
    exp: Math.floor(Date.now() / 1000) + maxAgeSec
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

export function readSessionToken(token: string | undefined, secret: string) {
  if (!token) return null;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded, secret);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.userId || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
