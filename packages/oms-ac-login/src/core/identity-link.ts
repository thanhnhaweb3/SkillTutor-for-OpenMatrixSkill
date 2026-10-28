import { AcError } from "./errors";
import type { AcUser, ConnectResult, LinkedIdentity, PublicAcUser } from "./types";
import { normalizeCountryDisclosure, normalizeLocale } from "./profile";
import type { UserStore } from "../store/user-store";

const connectProviders = [
  "opencampus",
  "github",
  "metamask",
  "x",
  "linkedin",
  "facebook",
  "google"
] as const;

export async function linkIdentity(
  store: UserStore,
  userId: string,
  result: ConnectResult
): Promise<AcUser> {
  const existing = await store.findByConnectSubject(result.provider, result.subject);
  if (existing && existing.id !== userId) {
    throw new AcError("identity_already_linked", 409);
  }

  const identity: LinkedIdentity = {
    provider: result.provider,
    subject: result.subject,
    displayHandle: result.displayHandle,
    displayName: result.displayName,
    avatarUrl: result.avatarUrl,
    ethAddress: result.ethAddress,
    linkedAt: new Date().toISOString(),
    scopes: result.scopes
  };

  return store.linkIdentity(userId, identity);
}

export function toPublicUser(user: AcUser): PublicAcUser {
  const connections = Object.fromEntries(
    connectProviders.map((provider) => {
      const identity = user.identities.find((item) => item.provider === provider);
      return [
        provider,
        identity
          ? {
              linked: true,
              handle: identity.displayHandle,
              displayName: identity.displayName,
              avatarUrl: identity.avatarUrl,
              ethAddress: identity.ethAddress
            }
          : { linked: false }
      ];
    })
  ) as PublicAcUser["connections"];

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatarInitials: user.avatarInitials,
    primaryAdapter: user.primaryAdapter,
    locale: normalizeLocale(user.locale),
    countryCode: user.countryDisclosure === "provided" ? user.countryCode : undefined,
    countryDisclosure: normalizeCountryDisclosure(user.countryDisclosure),
    connections
  };
}
