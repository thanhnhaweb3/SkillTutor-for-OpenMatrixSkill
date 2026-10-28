import type { AcConfig, ConnectProviderId } from "../core/types";

const connectIds: ConnectProviderId[] = [
  "opencampus",
  "github",
  "metamask",
  "x",
  "linkedin",
  "facebook",
  "google"
];

function readBoolean(name: string, fallback = false) {
  const value = process.env[name];
  if (value == null) return fallback;
  return value === "true";
}

export function loadAcConfig(): AcConfig {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return {
    appUrl,
    primaryAdapter: (process.env.AC_PRIMARY_ADAPTER ?? "local") as AcConfig["primaryAdapter"],
    sessionSecret: process.env.AC_SESSION_SECRET ?? "dev-change-me",
    sessionMaxAgeSec: Number(process.env.AC_SESSION_MAX_AGE_SEC ?? 604800),
    userStorePath: process.env.AC_USER_STORE_PATH ?? "./data/users.json",
    localDataStorage: readBoolean("AC_LOCAL_DATA_STORAGE", true),
    allowConnectWithoutSession: readBoolean("AC_ALLOW_CONNECT_WITHOUT_SESSION"),
    connect: {
      opencampus: readBoolean("AC_CONNECT_OCID", true),
      github: readBoolean("AC_CONNECT_GITHUB", true),
      metamask: readBoolean("AC_CONNECT_METAMASK", true),
      x: readBoolean("AC_CONNECT_X", true),
      linkedin: readBoolean("AC_CONNECT_LINKEDIN", true),
      facebook: readBoolean("AC_CONNECT_FACEBOOK"),
      google: readBoolean("AC_CONNECT_GOOGLE", true)
    },
    features: {
      connectedAccountsConsole: process.env.AC_CONNECTED_ACCOUNTS !== "false",
      credentialsGallery: process.env.AC_CREDENTIALS_GALLERY !== "false",
      legacyRouteAlias: readBoolean("AC_USE_LEGACY_ROUTES"),
      profileMutations: readBoolean("AC_PROFILE_MUTATIONS_ENABLED")
    }
  };
}

export { connectIds };
