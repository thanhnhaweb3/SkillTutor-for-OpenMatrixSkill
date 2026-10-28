export type PrimaryAdapterId = "cognito" | "local" | "keycloak";

export type ConnectProviderId =
  | "opencampus"
  | "github"
  | "metamask"
  | "x"
  | "linkedin"
  | "facebook"
  | "google";

export type UserRole = "learner" | "instructor" | "admin";
export type SupportedLocale = "vi" | "en";
export type CountryDisclosure = "unset" | "provided" | "declined";

export interface LearnerProfilePatch {
  locale: SupportedLocale;
  countryDisclosure: CountryDisclosure;
  countryCode?: string;
}

export interface LinkedIdentity {
  provider: ConnectProviderId;
  subject: string;
  displayHandle?: string;
  displayName?: string;
  avatarUrl?: string;
  ethAddress?: string;
  linkedAt: string;
  scopes?: string[];
}

export interface AcUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarInitials: string;
  primaryAdapter: PrimaryAdapterId;
  primarySubject: string;
  ocid?: string;
  ethAddress?: string;
  evmAddress?: string;
  metamaskWalletId?: string;
  githubLogin?: string;
  identities: LinkedIdentity[];
  locale?: SupportedLocale;
  countryCode?: string;
  countryDisclosure?: CountryDisclosure;
  countryUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
  password?: string;
}

export interface PublicConnection {
  linked: boolean;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  ethAddress?: string;
}

export interface PublicAcUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarInitials: string;
  primaryAdapter: PrimaryAdapterId;
  locale: SupportedLocale;
  countryCode?: string;
  countryDisclosure: CountryDisclosure;
  connections: Record<ConnectProviderId, PublicConnection>;
}

export interface PrimaryAuthResult {
  subject: string;
  email: string;
  name?: string;
  groups?: string[];
  rawClaims?: Record<string, unknown>;
}

export interface ConnectResult {
  provider: ConnectProviderId;
  subject: string;
  displayHandle?: string;
  displayName?: string;
  avatarUrl?: string;
  ethAddress?: string;
  scopes?: string[];
}

export interface ConnectProviderMeta {
  id: ConnectProviderId;
  displayName: string;
  description: string;
  category: "credentials" | "social";
  enabled: boolean;
}

export interface AcConfig {
  appUrl: string;
  primaryAdapter: PrimaryAdapterId;
  sessionSecret: string;
  sessionMaxAgeSec: number;
  userStorePath: string;
  localDataStorage: boolean;
  allowConnectWithoutSession: boolean;
  connect: Record<ConnectProviderId, boolean>;
  features: {
    connectedAccountsConsole: boolean;
    credentialsGallery: boolean;
    legacyRouteAlias: boolean;
    profileMutations: boolean;
  };
}

export interface AcRegistry {
  primary: {
    id: PrimaryAdapterId;
    displayName: string;
  };
  connect: ConnectProviderMeta[];
}
