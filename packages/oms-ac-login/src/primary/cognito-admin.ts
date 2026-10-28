import { createHash, createHmac } from "node:crypto";
import type { AcConfig, AcUser } from "../core/types";

type CognitoSyncStatus = "synced" | "skipped" | "failed";

interface CognitoApiError {
  __type?: string;
  message?: string;
}

interface CognitoUser {
  Username?: string;
}

interface ListUsersResponse {
  Users?: CognitoUser[];
}

export interface CognitoSyncResult {
  status: CognitoSyncStatus;
  reason?: string;
}

const service = "cognito-idp";
const algorithm = "AWS4-HMAC-SHA256";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function getSignatureKey(secretAccessKey: string, dateStamp: string, region: string) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const dateRegionKey = hmac(dateKey, region);
  const dateRegionServiceKey = hmac(dateRegionKey, service);
  return hmac(dateRegionServiceKey, "aws4_request");
}

function amzDateParts(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8)
  };
}

function requiredCognitoEnv() {
  const region = process.env.COGNITO_REGION?.trim();
  const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();

  if (!region || !userPoolId || !accessKeyId || !secretAccessKey) return null;

  return {
    region,
    userPoolId,
    accessKeyId,
    secretAccessKey,
    sessionToken
  };
}

async function signedCognitoRequest<T>(
  settings: NonNullable<ReturnType<typeof requiredCognitoEnv>>,
  action: "ListUsers" | "AdminUpdateUserAttributes",
  payload: Record<string, unknown>
) {
  const host = `${service}.${settings.region}.amazonaws.com`;
  const endpoint = `https://${host}/`;
  const body = JSON.stringify(payload);
  const { amzDate, dateStamp } = amzDateParts();
  const target = `AWSCognitoIdentityProviderService.${action}`;
  const headers: Record<string, string> = {
    "content-type": "application/x-amz-json-1.1",
    host,
    "x-amz-date": amzDate,
    "x-amz-target": target
  };

  if (settings.sessionToken) {
    headers["x-amz-security-token"] = settings.sessionToken;
  }

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name].trim()}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");
  const credentialScope = `${dateStamp}/${settings.region}/${service}/aws4_request`;
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256(body)
  ].join("\n");
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join("\n");
  const signingKey = getSignatureKey(settings.secretAccessKey, dateStamp, settings.region);
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...headers,
      authorization: `${algorithm} Credential=${settings.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    },
    body
  });

  const data = (await response.json()) as T & CognitoApiError;
  if (!response.ok) {
    const code = data.__type?.split("#").pop() ?? "cognito_admin_request_failed";
    throw new Error(data.message ? `${code}: ${data.message}` : code);
  }

  return data;
}

async function findCognitoUsername(
  settings: NonNullable<ReturnType<typeof requiredCognitoEnv>>,
  user: AcUser
) {
  const result = await signedCognitoRequest<ListUsersResponse>(settings, "ListUsers", {
    UserPoolId: settings.userPoolId,
    Filter: `sub = "${user.primarySubject}"`,
    Limit: 1
  });

  return result.Users?.[0]?.Username ?? user.primarySubject;
}

export async function syncMetamaskWalletIdToCognito(
  _config: AcConfig,
  user: AcUser,
  walletId: string
): Promise<CognitoSyncResult> {
  if (user.primaryAdapter !== "cognito") {
    return { status: "skipped", reason: "primary_adapter_not_cognito" };
  }

  const settings = requiredCognitoEnv();
  if (!settings) {
    return { status: "skipped", reason: "missing_aws_admin_credentials" };
  }

  try {
    const username = await findCognitoUsername(settings, user);
    await signedCognitoRequest(settings, "AdminUpdateUserAttributes", {
      UserPoolId: settings.userPoolId,
      Username: username,
      UserAttributes: [
        {
          Name: "custom:metamask_wallet_id",
          Value: walletId
        }
      ]
    });

    return { status: "synced" };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "cognito_sync_failed"
    };
  }
}

export async function syncConnectHandleToCognito(
  _config: AcConfig,
  user: AcUser,
  attributeName: string,
  value: string
): Promise<CognitoSyncResult> {
  if (user.primaryAdapter !== "cognito") {
    return { status: "skipped", reason: "primary_adapter_not_cognito" };
  }

  const settings = requiredCognitoEnv();
  if (!settings) {
    return { status: "skipped", reason: "missing_aws_admin_credentials" };
  }

  try {
    const username = await findCognitoUsername(settings, user);
    await signedCognitoRequest(settings, "AdminUpdateUserAttributes", {
      UserPoolId: settings.userPoolId,
      Username: username,
      UserAttributes: [
        {
          Name: attributeName,
          Value: value
        }
      ]
    });

    return { status: "synced" };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "cognito_sync_failed"
    };
  }
}
