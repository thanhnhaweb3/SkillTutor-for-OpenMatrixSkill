import { NextRequest, NextResponse } from "next/server";
import { createAcRegistry } from "../config/provider-registry";
import { loadAcConfig } from "../config/load-config";
import { AcError, toErrorResponse } from "../core/errors";
import { linkIdentity, toPublicUser } from "../core/identity-link";
import { applyLearnerProfile, validateLearnerProfilePatch } from "../core/profile";
import { createSessionToken, readSessionToken, SESSION_COOKIE } from "../core/session";
import type {
  AcConfig,
  AcUser,
  ConnectProviderId,
  ConnectResult,
  PrimaryAuthResult
} from "../core/types";
import { buildUnifiedCredentials } from "../credentials/credentials-gallery";
import { buildMockConnectUrl, readMockConnectResult } from "../connect/mock-providers";
import { cognitoPrimaryAdapter, decodeCognitoState } from "../primary/cognito-adapter";
import {
  syncConnectHandleToCognito,
  syncMetamaskWalletIdToCognito
} from "../primary/cognito-admin";
import { localPrimaryAdapter } from "../primary/local-adapter";
import type { UserStore } from "../store/user-store";
import { createUserStore, usesPersistentUserStore } from "../store/create-user-store";

export interface AcHandlerContext {
  config?: AcConfig;
  store?: UserStore;
}

function getContext(context: AcHandlerContext = {}) {
  const config = context.config ?? loadAcConfig();
  const store = context.store ?? createUserStore(config);
  const registry = createAcRegistry(config);
  const primary =
    config.primaryAdapter === "local"
      ? localPrimaryAdapter(store)
      : cognitoPrimaryAdapter(config);

  return { config, store, registry, primary };
}

function redirectTo(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url));
}

function setSessionCookie(response: NextResponse, config: AcConfig, user: AcUser) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: createSessionToken(
      user.id,
      config.sessionSecret,
      config.sessionMaxAgeSec,
      usesPersistentUserStore(config) ? undefined : user
    ),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: config.sessionMaxAgeSec,
    path: "/"
  });
}

function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/"
  });
}

function setLocaleCookie(response: NextResponse, locale: "vi" | "en") {
  response.cookies.set({
    name: "oms-locale",
    value: locale,
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 31_536_000,
    path: "/"
  });
}

async function findOrCreateFromPrimary(
  store: UserStore,
  adapter: AcConfig["primaryAdapter"],
  result: PrimaryAuthResult
) {
  const bySubject = await store.findByPrimarySubject(adapter, result.subject);
  if (bySubject) return bySubject;

  const byEmail = await store.findByEmail(result.email);
  if (byEmail) {
    return store.update(byEmail.id, {
      primaryAdapter: adapter,
      primarySubject: result.subject
    });
  }

  return store.createFromPrimary(result, adapter);
}

async function requireSession(request: NextRequest, context?: AcHandlerContext) {
  const { config, store } = getContext(context);
  const payload = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value, config.sessionSecret);
  if (!payload) throw new AcError("session_required", 401);

  const user = usesPersistentUserStore(config) ? await store.findById(payload.userId) : payload.user;
  if (!user) throw new AcError("unauthorized", 401);

  return { config, store, user };
}

function createSessionOnlyUser(result: PrimaryAuthResult, adapter: AcConfig["primaryAdapter"]): AcUser {
  const now = new Date().toISOString();
  const name = result.name ?? result.email.split("@")[0];
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const avatarInitials =
    parts.length >= 2
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : (parts[0]?.slice(0, 2) ?? result.email.slice(0, 2)).toUpperCase();

  return {
    id: `cognito-${result.subject}`,
    email: result.email,
    name,
    role: "learner",
    avatarInitials,
    primaryAdapter: adapter,
    primarySubject: result.subject,
    identities: [],
    createdAt: now,
    updatedAt: now
  };
}

function linkIdentityInSession(user: AcUser, result: ConnectResult): AcUser {
  const identity = {
    provider: result.provider,
    subject: result.subject,
    displayHandle: result.displayHandle,
    displayName: result.displayName,
    avatarUrl: result.avatarUrl,
    ethAddress: result.ethAddress,
    linkedAt: new Date().toISOString(),
    scopes: result.scopes
  };
  const updated: AcUser = {
    ...user,
    identities: [...user.identities.filter((item) => item.provider !== result.provider), identity],
    updatedAt: new Date().toISOString()
  };

  if (result.provider === "opencampus") {
    updated.ocid = result.displayHandle ?? result.subject;
    updated.ethAddress = result.ethAddress;
  } else if (result.provider === "github") {
    updated.githubLogin = result.displayHandle;
  } else if (result.provider === "metamask") {
    updated.evmAddress = result.ethAddress ?? result.displayHandle;
    updated.metamaskWalletId = result.ethAddress ?? result.displayHandle;
  }

  return updated;
}

function unlinkIdentityInSession(user: AcUser, provider: ConnectProviderId): AcUser {
  const updated: AcUser = {
    ...user,
    identities: user.identities.filter((item) => item.provider !== provider),
    updatedAt: new Date().toISOString()
  };
  if (provider === "opencampus") {
    delete updated.ocid;
    delete updated.ethAddress;
  } else if (provider === "github") {
    delete updated.githubLogin;
  } else if (provider === "metamask") {
    delete updated.evmAddress;
    delete updated.metamaskWalletId;
  }
  return updated;
}

function normalizeEvmAddress(value: unknown) {
  if (typeof value !== "string") throw new AcError("invalid_wallet_address", 400);

  const address = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new AcError("invalid_wallet_address", 400);
  }

  return address;
}

const manualSocialProviders = ["github", "google", "x", "linkedin", "facebook"] as const;

function isManualSocialProvider(provider: ConnectProviderId) {
  return manualSocialProviders.some((item) => item === provider);
}

function normalizeManualHandle(value: unknown) {
  if (typeof value !== "string") throw new AcError("invalid_handle", 400);

  const handle = value.trim().replace(/\s+/g, " ");
  if (!handle || handle.length > 80) throw new AcError("invalid_handle", 400);
  if (!/^[\p{L}\p{N}@._:/\- ]+$/u.test(handle)) {
    throw new AcError("invalid_handle", 400);
  }

  return handle;
}

function socialHandleAttributeName(provider: ConnectProviderId) {
  return `custom:${provider}_handle`;
}

export function createAcHandlers(context: AcHandlerContext = {}) {
  return {
    async authLogin(request: NextRequest) {
      try {
        const { primary } = getContext(context);
        const returnUrl = request.nextUrl.searchParams.get("returnUrl") ?? "/settings/connections";

        if (primary.id === "local") {
          return redirectTo(request, `/login?returnUrl=${encodeURIComponent(returnUrl)}`);
        }

        return NextResponse.redirect(primary.buildLoginUrl({ returnUrl }));
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async authLoginPost(request: NextRequest) {
      try {
        const { config, store, primary } = getContext(context);
        if (!primary.handleLocalLogin) throw new AcError("adapter_misconfigured", 500);

        const body = (await request.json()) as { email?: string; password?: string; returnUrl?: string };
        if (!body.email || !body.password) throw new AcError("invalid_request", 400);

        const result = await primary.handleLocalLogin({
          email: body.email,
          password: body.password
        });
        const user = await findOrCreateFromPrimary(store, config.primaryAdapter, result);
        const response = NextResponse.json({
          ok: true,
          returnUrl: body.returnUrl ?? "/settings/connections",
          user: toPublicUser(user)
        });
        setSessionCookie(response, config, user);
        return response;
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async authCallback(request: NextRequest) {
      const returnUrl = decodeCognitoState(request.nextUrl.searchParams.get("state"));

      try {
        const { config, store, primary } = getContext(context);
        const providerError = request.nextUrl.searchParams.get("error");
        if (providerError) throw new AcError(providerError, 401);
        if (!primary.handleCallback) throw new AcError("adapter_misconfigured", 500);

        const result = await primary.handleCallback(request);
        const user = usesPersistentUserStore(config)
          ? await findOrCreateFromPrimary(store, config.primaryAdapter, result)
          : createSessionOnlyUser(result, config.primaryAdapter);
        const response = redirectTo(request, returnUrl);
        setSessionCookie(response, config, user);
        return response;
      } catch (error) {
        console.error("Cognito auth callback failed", error);
        const code =
          error instanceof AcError
            ? error.code
            : error instanceof Error && error.name === "AccessDeniedException"
              ? "user_store_access_denied"
              : "internal_error";
        return redirectTo(request, `${returnUrl}?error=${encodeURIComponent(code)}`);
      }
    },

    async authSignUp(request: NextRequest) {
      try {
        const { primary } = getContext(context);
        if (!primary.handleSignUp) throw new AcError("adapter_misconfigured", 500);

        const body = (await request.json()) as {
          email?: string;
          name?: string;
          password?: string;
        };
        if (!body.email || !body.name || !body.password) {
          throw new AcError("invalid_request", 400);
        }

        const result = await primary.handleSignUp({
          email: body.email,
          name: body.name,
          password: body.password
        });

        return Response.json({ ok: true, ...result });
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async authConfirmSignUp(request: NextRequest) {
      try {
        const { primary } = getContext(context);
        if (!primary.handleConfirmSignUp) throw new AcError("adapter_misconfigured", 500);

        const body = (await request.json()) as {
          email?: string;
          code?: string;
        };
        if (!body.email || !body.code) throw new AcError("invalid_request", 400);

        await primary.handleConfirmSignUp({
          email: body.email,
          code: body.code
        });

        return Response.json({ ok: true });
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async authResendSignUpCode(request: NextRequest) {
      try {
        const { primary } = getContext(context);
        if (!primary.handleResendSignUpCode) throw new AcError("adapter_misconfigured", 500);

        const body = (await request.json()) as {
          email?: string;
        };
        if (!body.email) throw new AcError("invalid_request", 400);

        const result = await primary.handleResendSignUpCode({
          email: body.email
        });

        return Response.json({ ok: true, ...result });
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async authLogout(request: NextRequest) {
      const returnUrl = request.nextUrl.searchParams.get("returnUrl") ?? "/login";
      const response = redirectTo(request, returnUrl);
      clearSessionCookie(response);
      return response;
    },

    async me(request: NextRequest) {
      try {
        const { user } = await requireSession(request, context);
        return NextResponse.json({ user: toPublicUser(user) }, { headers: { "cache-control": "private, no-store" } });
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async profileUpdate(request: NextRequest) {
      try {
        const { config, store, user } = await requireSession(request, context);
        if (!config.features.profileMutations) throw new AcError("PROFILE_MUTATIONS_DISABLED", 503);
        const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.startsWith("application/json")) throw new AcError("VALIDATION_ERROR", 415);
        if (request.headers.get("origin") !== new URL(config.appUrl).origin) throw new AcError("INVALID_ORIGIN", 403);
        const raw = await request.text();
        if (Buffer.byteLength(raw, "utf8") > 2_048) throw new AcError("VALIDATION_ERROR", 413);
        let body: unknown;
        try { body = JSON.parse(raw); } catch { throw new AcError("VALIDATION_ERROR", 422); }
        const patch = validateLearnerProfilePatch(body);
        const updatedUser = usesPersistentUserStore(config)
          ? await store.updateLearnerProfile(user.id, patch)
          : applyLearnerProfile(user, patch);
        const response = NextResponse.json({ user: toPublicUser(updatedUser) }, { headers: { "cache-control": "private, no-store" } });
        setLocaleCookie(response, patch.locale);
        if (!usesPersistentUserStore(config)) setSessionCookie(response, config, updatedUser);
        return response;
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async identities(request: NextRequest) {
      try {
        const { user } = await requireSession(request, context);
        return Response.json({
          identities: user.identities.map(({ subject: _subject, ...identity }) => identity)
        });
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async connectLogin(request: NextRequest, provider: ConnectProviderId) {
      try {
        const { config, registry } = getContext(context);
        const enabled = registry.connect.some((item) => item.id === provider);
        if (!enabled) throw new AcError("provider_disabled", 404);

        if (!config.allowConnectWithoutSession) {
          await requireSession(request, context);
        }

        const returnUrl =
          request.nextUrl.searchParams.get("returnUrl") ?? "/settings/connections";
        return redirectTo(request, buildMockConnectUrl(provider, returnUrl));
      } catch (error) {
        if (error instanceof AcError && error.code === "session_required") {
          return redirectTo(request, "/login?error=session_required");
        }
        return toErrorResponse(error);
      }
    },

    async connectCallback(request: NextRequest, provider: ConnectProviderId) {
      try {
        const { config, store, user } = await requireSession(request, context);
        const result = readMockConnectResult(provider);
        const updatedUser = usesPersistentUserStore(config)
          ? await linkIdentity(store, user.id, result)
          : linkIdentityInSession(user, result);

        const returnUrl =
          request.nextUrl.searchParams.get("returnUrl") ?? "/settings/connections";
        const response = redirectTo(request, `${returnUrl}?linked=${provider}`);
        if (!usesPersistentUserStore(config)) setSessionCookie(response, config, updatedUser);
        return response;
      } catch (error) {
        const returnUrl =
          request.nextUrl.searchParams.get("returnUrl") ?? "/settings/connections";
        const code = error instanceof AcError ? error.code : "internal_error";
        return redirectTo(request, `${returnUrl}?error=${code}`);
      }
    },

    async connectUnlink(request: NextRequest, provider: ConnectProviderId) {
      try {
        const { config, store, user } = await requireSession(request, context);
        const updatedUser = usesPersistentUserStore(config)
          ? await store.unlinkIdentity(user.id, provider)
          : unlinkIdentityInSession(user, provider);
        const response = NextResponse.json({ ok: true, user: toPublicUser(updatedUser) });
        if (!usesPersistentUserStore(config)) setSessionCookie(response, config, updatedUser);
        return response;
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async connectManualHandle(request: NextRequest, provider: ConnectProviderId) {
      try {
        const { config, store, user } = await requireSession(request, context);
        const registry = createAcRegistry(config);
        const enabled = registry.connect.some((item) => item.id === provider);
        if (!enabled || !isManualSocialProvider(provider)) {
          throw new AcError("provider_disabled", 404);
        }

        const body = (await request.json()) as { handle?: unknown };
        const handle = normalizeManualHandle(body.handle);
        const subject = `${provider}:${handle.toLowerCase()}`;
        const existing = usesPersistentUserStore(config)
          ? await store.findByConnectSubject(provider, subject)
          : null;

        if (existing && existing.id !== user.id) {
          throw new AcError("identity_already_linked", 409);
        }

        const result: ConnectResult = {
          provider,
          subject,
          displayHandle: handle,
          displayName: handle,
          scopes: ["manual_profile"]
        };
        const updatedUser = usesPersistentUserStore(config)
          ? await linkIdentity(store, user.id, result)
          : linkIdentityInSession(user, result);
        const cognitoSync = await syncConnectHandleToCognito(
          config,
          updatedUser,
          socialHandleAttributeName(provider),
          handle
        );

        const response = NextResponse.json({
          ok: true,
          user: toPublicUser(updatedUser),
          cognitoSync
        });
        if (!usesPersistentUserStore(config)) setSessionCookie(response, config, updatedUser);
        return response;
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async connectMetamaskWallet(request: NextRequest) {
      try {
        const { config, store, user } = await requireSession(request, context);
        const registry = createAcRegistry(config);
        const enabled = registry.connect.some((item) => item.id === "metamask");
        if (!enabled) throw new AcError("provider_disabled", 404);

        const body = (await request.json()) as { address?: unknown };
        const address = normalizeEvmAddress(body.address);
        const normalizedAddress = address.toLowerCase();
        const existing = usesPersistentUserStore(config)
          ? await store.findByConnectSubject("metamask", normalizedAddress)
          : null;

        if (existing && existing.id !== user.id) {
          throw new AcError("identity_already_linked", 409);
        }

        const result: ConnectResult = {
          provider: "metamask",
          subject: normalizedAddress,
          displayHandle: address,
          displayName: "MetaMask Wallet",
          ethAddress: address,
          scopes: ["eth_accounts"]
        };
        const updatedUser = usesPersistentUserStore(config)
          ? await linkIdentity(store, user.id, result)
          : linkIdentityInSession(user, result);
        const cognitoSync = await syncMetamaskWalletIdToCognito(
          config,
          updatedUser,
          normalizedAddress
        );

        const response = NextResponse.json({
          ok: true,
          user: toPublicUser(updatedUser),
          walletId: normalizedAddress,
          cognitoSync
        });
        if (!usesPersistentUserStore(config)) setSessionCookie(response, config, updatedUser);
        return response;
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async connectStatus(request: NextRequest, provider: ConnectProviderId) {
      try {
        const { user } = await requireSession(request, context);
        const publicUser = toPublicUser(user);
        return Response.json(publicUser.connections[provider]);
      } catch (error) {
        return toErrorResponse(error);
      }
    },

    async unifiedCredentials(request: NextRequest) {
      try {
        const { user } = await requireSession(request, context);
        return Response.json(buildUnifiedCredentials(user));
      } catch (error) {
        return toErrorResponse(error);
      }
    }
  };
}
