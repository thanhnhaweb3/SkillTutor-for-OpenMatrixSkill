import type { AcConfig, AcRegistry, ConnectProviderMeta, ConnectProviderId } from "../core/types";

const providerMeta: Record<ConnectProviderId, Omit<ConnectProviderMeta, "enabled">> = {
  opencampus: {
    id: "opencampus",
    displayName: "Open Campus OCID",
    description: "EDU Chain credentials and OC badges",
    category: "credentials"
  },
  github: {
    id: "github",
    displayName: "GitHub",
    description: "Developer profile, labs and classroom sync",
    category: "social"
  },
  metamask: {
    id: "metamask",
    displayName: "MetaMask",
    description: "EVM wallet address for Web3 credentials",
    category: "credentials"
  },
  google: {
    id: "google",
    displayName: "Google",
    description: "Secondary email and future calendar integrations",
    category: "social"
  },
  facebook: {
    id: "facebook",
    displayName: "Facebook",
    description: "Social portfolio link",
    category: "social"
  },
  x: {
    id: "x",
    displayName: "X",
    description: "Public handle for badge sharing",
    category: "social"
  },
  linkedin: {
    id: "linkedin",
    displayName: "LinkedIn",
    description: "Professional profile and career portfolio",
    category: "social"
  }
};

const primaryDisplayName: Record<AcConfig["primaryAdapter"], string> = {
  local: "OpenMatrix Skill Local Email",
  cognito: "OpenMatrix Skill Account",
  keycloak: "Keycloak"
};

export function createAcRegistry(config: AcConfig): AcRegistry {
  const connect = Object.values(providerMeta)
    .map((provider) => ({
      ...provider,
      enabled: config.connect[provider.id]
    }))
    .filter((provider) => provider.enabled);

  return {
    primary: {
      id: config.primaryAdapter,
      displayName: primaryDisplayName[config.primaryAdapter] ?? config.primaryAdapter
    },
    connect
  };
}

export function getProviderMeta(provider: ConnectProviderId) {
  return providerMeta[provider];
}
