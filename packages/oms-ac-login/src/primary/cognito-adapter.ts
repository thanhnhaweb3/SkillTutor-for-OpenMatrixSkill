import { createHash, createHmac } from "node:crypto";
import type { AcConfig } from "../core/types";
import { AcError } from "../core/errors";
import type { PrimaryAuthAdapter } from "./types";

interface CognitoSettings {
  region: string;
  userPoolId: string;
  clientId: string;
  clientSecret?: string;
  domain: string;
  redirectUri: string;
  scopes: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface CognitoClaims {
  sub?: string;
  aud?: string;
  client_id?: string;
  iss?: string;
  exp?: number;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  "cognito:groups"?: string[];
}

interface CognitoTokenResponse {
  id_token: string;
  error?: string;
}

interface CognitoSignUpResponse {
  UserConfirmed?: boolean;
  CodeDeliveryDetails?: {
    Destination?: string;
    DeliveryMedium?: string;
  };
}

interface CognitoResendConfirmationCodeResponse {
  CodeDeliveryDetails?: {
    Destination?: string;
    DeliveryMedium?: string;
  };
}

type CognitoJwk = JsonWebKey & { kid?: string };

const PLACEHOLDER_RE = /^x+$/i;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value || PLACEHOLDER_RE.test(value)) {
    throw new AcError("adapter_misconfigured", 500, `${name} is required`);
  }
  return value;
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value || PLACEHOLDER_RE.test(value)) return undefined;
  return value;
}

function getSettings(config: AcConfig): CognitoSettings {
  const appUrl = config.appUrl.replace(/\/$/, "");

  return {
    region: requiredEnv("COGNITO_REGION"),
    userPoolId: requiredEnv("COGNITO_USER_POOL_ID"),
    clientId: requiredEnv("COGNITO_CLIENT_ID"),
    clientSecret: optionalEnv("COGNITO_CLIENT_SECRET"),
    domain: requiredEnv("COGNITO_DOMAIN").replace(/^https?:\/\//, "").replace(/\/$/, ""),
    redirectUri: process.env.COGNITO_REDIRECT_URI?.trim() || `${appUrl}/api/ac/auth/callback`,
    scopes: process.env.COGNITO_SCOPES?.trim() || "openid email profile"
  };
}

function encodeState(returnUrl: string) {
  return Buffer.from(JSON.stringify({ returnUrl }), "utf8").toString("base64url");
}

export function decodeCognitoState(state: string | null) {
  if (!state) return "/settings/connections";

  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      returnUrl?: unknown;
    };

    if (typeof parsed.returnUrl === "string" && parsed.returnUrl.startsWith("/")) {
      return parsed.returnUrl;
    }
  } catch {
    // Fall through to the default return URL.
  }

  return "/settings/connections";
}

function decodeJwtPart<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function secretHash(username: string, settings: CognitoSettings) {
  if (!settings.clientSecret) return undefined;

  return createHmac("sha256", settings.clientSecret)
    .update(`${username}${settings.clientId}`)
    .digest("base64");
}

function cognitoUsernameFromEmail(email: string) {
  const hash = createHash("sha256").update(email).digest("hex").slice(0, 24);
  return `oms_${hash}`;
}

async function callCognito<T>(
  settings: CognitoSettings,
  action: "SignUp" | "ConfirmSignUp" | "ResendConfirmationCode",
  payload: Record<string, unknown>
) {
  const response = await fetch(`https://cognito-idp.${settings.region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityProviderService.${action}`
    },
    body: JSON.stringify(payload)
  });

  const data = (await response.json()) as T & {
    __type?: string;
    message?: string;
  };

  if (!response.ok) {
    const rawCode = data.__type?.split("#").pop() ?? "cognito_request_failed";
    throw new AcError(rawCode, response.status, data.message ?? rawCode);
  }

  return data;
}

async function verifyCognitoIdToken(idToken: string, settings: CognitoSettings) {
  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new AcError("invalid_id_token", 401);
  }

  const header = decodeJwtPart<JwtHeader>(encodedHeader);
  const claims = decodeJwtPart<CognitoClaims>(encodedPayload);
  if (header.alg !== "RS256" || !header.kid) throw new AcError("invalid_id_token", 401);

  const issuer = `https://cognito-idp.${settings.region}.amazonaws.com/${settings.userPoolId}`;
  if (claims.iss !== issuer) throw new AcError("invalid_issuer", 401);
  if (claims.aud !== settings.clientId && claims.client_id !== settings.clientId) {
    throw new AcError("invalid_audience", 401);
  }
  if (!claims.exp || claims.exp * 1000 <= Date.now()) throw new AcError("token_expired", 401);

  const jwksResponse = await fetch(`${issuer}/.well-known/jwks.json`);
  if (!jwksResponse.ok) throw new AcError("jwks_unavailable", 502);

  const jwks = (await jwksResponse.json()) as { keys?: CognitoJwk[] };
  const jwk = jwks.keys?.find((key) => key.kid === header.kid);
  if (!jwk) throw new AcError("signing_key_not_found", 401);

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    Buffer.from(encodedSignature, "base64url"),
    Buffer.from(`${encodedHeader}.${encodedPayload}`)
  );

  if (!verified) throw new AcError("invalid_id_token_signature", 401);
  return claims;
}

async function exchangeCodeForTokens(
  request: Request,
  settings: CognitoSettings
): Promise<CognitoTokenResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) throw new AcError("invalid_callback", 400);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: settings.redirectUri
  });

  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded"
  });

  if (settings.clientSecret) {
    headers.set(
      "authorization",
      `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString("base64")}`
    );
  } else {
    body.set("client_id", settings.clientId);
  }

  const response = await fetch(`https://${settings.domain}/oauth2/token`, {
    method: "POST",
    headers,
    body
  });

  const payload = (await response.json()) as { id_token?: string; error?: string };
  if (!response.ok || !payload.id_token) {
    throw new AcError(payload.error ?? "token_exchange_failed", 401);
  }

  return { id_token: payload.id_token };
}

export function cognitoPrimaryAdapter(config: AcConfig): PrimaryAuthAdapter {
  return {
    id: "cognito",
    displayName: "OpenMatrix Skill Account",
    buildLoginUrl({ returnUrl }) {
      const settings = getSettings(config);
      const params = new URLSearchParams({
        client_id: settings.clientId,
        response_type: "code",
        scope: settings.scopes,
        redirect_uri: settings.redirectUri,
        state: encodeState(returnUrl)
      });

      return `https://${settings.domain}/login?${params.toString()}`;
    },
    async handleCallback(request) {
      const settings = getSettings(config);
      const tokens = await exchangeCodeForTokens(request, settings);
      const claims = await verifyCognitoIdToken(tokens.id_token, settings);

      if (!claims.sub || !claims.email) throw new AcError("invalid_id_token_claims", 401);
      const displayName =
        claims.name ||
        [claims.given_name, claims.family_name].filter(Boolean).join(" ") ||
        claims.email.split("@")[0];

      return {
        subject: claims.sub,
        email: claims.email,
        name: displayName,
        groups: claims["cognito:groups"],
        rawClaims: claims as unknown as Record<string, unknown>
      };
    },
    async handleSignUp(input) {
      const settings = getSettings(config);
      const email = input.email.trim().toLowerCase();
      const name = input.name.trim();
      const username = cognitoUsernameFromEmail(email);
      const hash = secretHash(username, settings);

      const response = await callCognito<CognitoSignUpResponse>(settings, "SignUp", {
        ClientId: settings.clientId,
        Username: username,
        Password: input.password,
        SecretHash: hash,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "name", Value: name }
        ].filter((attribute) => attribute.Value)
      });

      return {
        userConfirmed: response.UserConfirmed === true,
        delivery: {
          destination: response.CodeDeliveryDetails?.Destination,
          medium: response.CodeDeliveryDetails?.DeliveryMedium
        }
      };
    },
    async handleConfirmSignUp(input) {
      const settings = getSettings(config);
      const email = input.email.trim().toLowerCase();
      const username = cognitoUsernameFromEmail(email);
      const hash = secretHash(username, settings);

      await callCognito(settings, "ConfirmSignUp", {
        ClientId: settings.clientId,
        Username: username,
        ConfirmationCode: input.code.trim(),
        SecretHash: hash
      });
    },
    async handleResendSignUpCode(input) {
      const settings = getSettings(config);
      const email = input.email.trim().toLowerCase();
      const username = cognitoUsernameFromEmail(email);
      const hash = secretHash(username, settings);

      const response = await callCognito<CognitoResendConfirmationCodeResponse>(
        settings,
        "ResendConfirmationCode",
        {
          ClientId: settings.clientId,
          Username: username,
          SecretHash: hash
        }
      );

      return {
        userConfirmed: false,
        delivery: {
          destination: response.CodeDeliveryDetails?.Destination,
          medium: response.CodeDeliveryDetails?.DeliveryMedium
        }
      };
    },
    buildLogoutUrl(returnUrl) {
      const settings = getSettings(config);
      const params = new URLSearchParams({
        client_id: settings.clientId,
        logout_uri: `${config.appUrl.replace(/\/$/, "")}${returnUrl}`
      });

      return `https://${settings.domain}/logout?${params.toString()}`;
    }
  };
}
