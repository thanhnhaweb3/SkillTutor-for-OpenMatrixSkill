"use client";

import { Award, BadgeCheck, BookOpenCheck, GraduationCap, Link2, Loader2, LogIn } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ConnectProviderId, SupportedLocale } from "../core/types";
import { useAcAuth } from "./hooks/useAcAuth";
import { useAcConnections } from "./hooks/useAcConnections";
import { ConnectProviderCard } from "./ConnectProviderCard";
import { localize } from "./i18n";

interface UnifiedCredential {
  id?: string;
  issuer?: string;
  title?: string;
  status?: string;
  source?: string;
  badgeId?: string;
  collectionSymbol?: string;
  kind?: string;
  type?: string;
  skillId?: string;
  skillName?: string;
  courseId?: string;
  courseName?: string;
}

const providers: Array<{
  id: ConnectProviderId;
  name: string;
  description: string;
  category: "credentials" | "social";
}> = [
  {
    id: "opencampus",
    name: "Open Campus OCID",
    description: "EDU Chain credentials and OC badges",
    category: "credentials"
  },
  {
    id: "github",
    name: "GitHub",
    description: "Developer profile, labs and classroom sync",
    category: "social"
  },
  {
    id: "metamask",
    name: "MetaMask",
    description: "Kết nối ví EVM để nhận credential Web3",
    category: "credentials"
  },
  {
    id: "google",
    name: "Google",
    description: "Secondary email and future integrations",
    category: "social"
  },
  {
    id: "x",
    name: "X",
    description: "Public handle for badge sharing",
    category: "social"
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    description: "Professional profile and career portfolio",
    category: "social"
  }
];

function collectUnifiedCredentials(payload: unknown): UnifiedCredential[] {
  if (!payload || typeof payload !== "object") return [];

  const data = payload as {
    credentials?: UnifiedCredential[];
    oms?: UnifiedCredential[];
    openCampus?: UnifiedCredential[];
  };

  return [
    ...(Array.isArray(data.credentials) ? data.credentials : []),
    ...(Array.isArray(data.oms) ? data.oms : []),
    ...(Array.isArray(data.openCampus) ? data.openCampus : [])
  ];
}

function countUnique(items: UnifiedCredential[], keys: Array<keyof UnifiedCredential>) {
  const values = new Set<string>();

  for (const item of items) {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === "string" && value.trim()) {
        values.add(value.trim());
        break;
      }
    }
  }

  return values.size;
}

export function ConnectedAccountsPanel({ locale = "vi" }: { locale?: SupportedLocale }) {
  const { status, user } = useAcAuth();
  const { connections, busyProvider, link, unlink } = useAcConnections(locale);
  const [credentials, setCredentials] = useState<UnifiedCredential[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") {
      setCredentials([]);
      return;
    }

    let active = true;
    setStatsLoading(true);

    fetch("/api/ac/credentials/unified", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) return [];
        return collectUnifiedCredentials(await response.json());
      })
      .then((items) => {
        if (active) setCredentials(items);
      })
      .catch(() => {
        if (active) setCredentials([]);
      })
      .finally(() => {
        if (active) setStatsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [status]);

  const dashboardStats = useMemo(() => {
    const linkedAccounts = connections
      ? Object.values(connections).filter((connection) => connection.linked).length
      : 0;

    const badges = credentials.filter(
      (credential) =>
        Boolean(credential.badgeId || credential.collectionSymbol) ||
        credential.kind === "badge" ||
        credential.type === "badge"
    ).length;

    return [
      {
        label: "Credential",
        value: credentials.length,
        icon: Award,
        tone: "text-lagoon bg-lagoon/10"
      },
      {
        label: "Badge",
        value: badges,
        icon: BadgeCheck,
        tone: "text-saffron bg-saffron/15"
      },
      {
        label: localize(locale, "Skill đã đạt", "Skills earned"),
        value: countUnique(credentials, ["skillId", "skillName"]),
        icon: GraduationCap,
        tone: "text-coral bg-coral/10"
      },
      {
        label: localize(locale, "Course đã học", "Courses completed"),
        value: countUnique(credentials, ["courseId", "courseName"]),
        icon: BookOpenCheck,
        tone: "text-ink bg-ink/10"
      },
      {
        label: localize(locale, "Tài khoản liên kết", "Connected accounts"),
        value: linkedAccounts,
        icon: Link2,
        tone: "text-lagoon bg-lagoon/10"
      }
    ];
  }, [connections, credentials, locale]);

  if (status === "loading") {
    return (
      <section className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center gap-3 text-sm font-medium text-ink/65">
          <Loader2 className="animate-spin text-lagoon" size={18} aria-hidden="true" />
          {localize(locale, "Đang tải phiên đăng nhập...", "Loading session...")}
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="grid gap-4 rounded-lg border border-saffron/30 bg-white p-4 shadow-sm sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-saffron">
            {localize(locale, "Chưa có session", "No active session")}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink">{localize(locale, "Cần đăng nhập", "Sign-in required")}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink/65">
            {localize(locale, "OpenMatrix Skill Account Connect yêu cầu session OMS chính trước khi liên kết provider.", "OpenMatrix Skill Account Connect requires a primary OMS session before linking a provider.")}
          </p>
        </div>
        <a
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-lagoon/90 focus:outline-none focus:ring-2 focus:ring-lagoon/25 focus:ring-offset-2"
          href="/login"
        >
          <LogIn size={16} aria-hidden="true" />
          {localize(locale, "Đăng nhập", "Sign in")}
        </a>
      </section>
    );
  }

  return (
    <section className="grid gap-5">
      <div className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lagoon">
              OpenMatrix Skill Dashboard
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">
              {localize(locale, "Xin chào", "Welcome")}, {user.name}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-ink/65">
              {localize(locale, "Tổng quan tiến độ học tập, chứng chỉ và các kết nối của tài khoản OMS.", "An overview of your OMS learning progress, credentials, and connections.")}
            </p>
          </div>
          <div className="flex w-full min-w-0 items-center gap-3 rounded-md border border-ink/10 bg-mist px-3 py-2 sm:w-auto sm:shrink-0">
            <div className="grid size-10 place-items-center rounded-md bg-ink text-sm font-bold text-white">
              {user.avatarInitials}
            </div>
            <div className="min-w-0">
              <p className="wrap-anywhere text-sm font-semibold text-ink">{user.email}</p>
              <p className="text-xs uppercase tracking-[0.14em] text-ink/45">
                {user.primaryAdapter}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-5">
          {dashboardStats.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="rounded-lg border border-ink/10 bg-mist p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className={`grid size-10 place-items-center rounded-md ${item.tone}`}>
                    <Icon size={20} aria-hidden="true" />
                  </div>
                  {statsLoading ? (
                    <Loader2 className="animate-spin text-ink/40" size={16} aria-hidden="true" />
                  ) : null}
                </div>
                <p className="text-2xl font-semibold text-ink">{item.value}</p>
                <p className="mt-1 text-sm font-medium leading-5 text-ink/65">{item.label}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">
          {localize(locale, "Chứng chỉ OpenMatrix Skill & Web3", "OpenMatrix Skill & Web3 credentials")}
        </p>
        {providers
          .filter((provider) => provider.category === "credentials")
          .map((provider) => (
            <ConnectProviderCard
              key={provider.id}
              id={provider.id}
              name={provider.name}
              description={provider.id === "opencampus"
                ? localize(locale, "Chứng chỉ EDU Chain và huy hiệu OC", provider.description)
                : localize(locale, "Kết nối ví EVM để nhận chứng chỉ Web3", provider.description)}
              connection={connections?.[provider.id]}
              busy={busyProvider === provider.id}
              onConnect={(handle) => link(provider.id, handle)}
              onDisconnect={() => unlink(provider.id)}
              locale={locale}
            />
          ))}
      </div>

      <div className="grid gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">
          {localize(locale, "Mạng xã hội", "Social accounts")}
        </p>
        {providers
          .filter((provider) => provider.category === "social")
          .map((provider) => (
            <ConnectProviderCard
              key={provider.id}
              id={provider.id}
              name={provider.name}
              description={provider.id === "github"
                ? localize(locale, "Hồ sơ lập trình, phòng lab và đồng bộ lớp học", provider.description)
                : provider.id === "google"
                  ? localize(locale, "Email phụ và các tích hợp trong tương lai", provider.description)
                  : provider.id === "x"
                    ? localize(locale, "Tên tài khoản công khai để chia sẻ huy hiệu", provider.description)
                    : localize(locale, "Hồ sơ nghề nghiệp và portfolio", provider.description)}
              connection={connections?.[provider.id]}
              busy={busyProvider === provider.id}
              manualEntry
              onConnect={(handle) => link(provider.id, handle)}
              onDisconnect={() => unlink(provider.id)}
              locale={locale}
            />
          ))}
      </div>
    </section>
  );
}
