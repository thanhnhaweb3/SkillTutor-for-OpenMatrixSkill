import { AcError } from "../core/errors";
import type { ConnectProviderId, ConnectResult } from "../core/types";

const mockProfiles: Record<ConnectProviderId, Omit<ConnectResult, "provider">> = {
  opencampus: {
    subject: "ocid:jane.doe",
    displayHandle: "jane.doe@edu.ocid",
    displayName: "Jane Doe",
    ethAddress: "0x7A8f3C1E4B9d2A6F0c3E2D1b9A8C7E6d5F4a3210",
    scopes: ["openid", "profile", "edu_credentials"]
  },
  github: {
    subject: "github:102938",
    displayHandle: "jane-openmatrix",
    displayName: "Jane Doe",
    avatarUrl: "https://github.com/identicons/jane-openmatrix.png",
    scopes: ["read:user", "user:email"]
  },
  metamask: {
    subject: "metamask:0x1111111111111111111111111111111111111111",
    displayHandle: "0x1111111111111111111111111111111111111111",
    displayName: "MetaMask Wallet",
    ethAddress: "0x1111111111111111111111111111111111111111",
    scopes: ["eth_accounts"]
  },
  google: {
    subject: "google:jane.gmail",
    displayHandle: "jane.openmatrix@gmail.com",
    displayName: "Jane Doe",
    scopes: ["openid", "email", "profile"]
  },
  facebook: {
    subject: "facebook:jane.doe",
    displayHandle: "jane.doe",
    displayName: "Jane Doe",
    scopes: ["public_profile"]
  },
  x: {
    subject: "x:jane_oms",
    displayHandle: "@jane_oms",
    displayName: "Jane Doe",
    scopes: ["users.read"]
  },
  linkedin: {
    subject: "linkedin:jane-doe",
    displayHandle: "linkedin.com/in/jane-doe",
    displayName: "Jane Doe",
    scopes: ["openid", "profile", "email"]
  }
};

export function buildMockConnectUrl(provider: ConnectProviderId, returnUrl: string) {
  const params = new URLSearchParams({ mock: "true", returnUrl });
  return `/api/ac/connect/${provider}/callback?${params.toString()}`;
}

export function readMockConnectResult(provider: ConnectProviderId): ConnectResult {
  const profile = mockProfiles[provider];
  if (!profile) throw new AcError("provider_disabled", 404);
  return { provider, ...profile };
}
