"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Code2,
  GraduationCap,
  Link2,
  Linkedin,
  Loader2,
  Mail,
  Share2,
  Unlink,
  Wallet,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ConnectProviderId, PublicConnection, SupportedLocale } from "../core/types";
import { localize } from "./i18n";

const iconMap = {
  opencampus: GraduationCap,
  github: Code2,
  metamask: Wallet,
  google: Mail,
  facebook: Users,
  x: Share2,
  linkedin: Linkedin
} satisfies Record<ConnectProviderId, LucideIcon>;

function formatMetamaskAddress(address?: string) {
  if (!address) return undefined;

  const trimmedAddress = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmedAddress)) return address;

  return `${trimmedAddress.slice(0, 8)}...${trimmedAddress.slice(-6)}`;
}

function getProfileUrl(id: ConnectProviderId, handle?: string) {
  if (id !== "x" || !handle) return undefined;

  const username = handle.trim().replace(/^@/, "");
  return username ? `https://x.com/${encodeURIComponent(username)}` : undefined;
}

interface ConnectProviderCardProps {
  id: ConnectProviderId;
  name: string;
  description: string;
  connection?: PublicConnection;
  busy: boolean;
  manualEntry?: boolean;
  onConnect: (handle?: string) => void;
  onDisconnect: () => void;
  locale?: SupportedLocale;
}

export function ConnectProviderCard({
  id,
  name,
  description,
  connection,
  busy,
  manualEntry = false,
  onConnect,
  onDisconnect,
  locale = "vi"
}: ConnectProviderCardProps) {
  const Icon = iconMap[id];
  const linked = Boolean(connection?.linked);
  const [manualHandle, setManualHandle] = useState("");
  const handle =
    id === "metamask"
      ? formatMetamaskAddress(connection?.ethAddress ?? connection?.handle)
      : connection?.handle;
  const profileUrl = getProfileUrl(id, handle);
  const manualHandleValue = manualHandle.trim();

  function handleConnect() {
    if (!manualEntry) {
      onConnect();
      return;
    }

    if (!manualHandleValue) {
      window.alert(localize(locale, "Vui lòng nhập tên tài khoản trước khi liên kết.", "Enter an account handle before connecting."));
      return;
    }

    onConnect(manualHandleValue);
  }

  return (
    <article
      className="grid min-h-24 min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-ink/10 bg-white p-4 shadow-sm transition hover:border-lagoon/25 hover:shadow-panel sm:gap-4"
      aria-labelledby={`provider-${id}`}
    >
      <div className="grid size-11 shrink-0 place-items-center rounded-md bg-mist text-lagoon">
        <Icon size={22} aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`provider-${id}`} className="text-base font-semibold text-ink">
              {name}
            </h3>
            <span
              className={
                linked
                  ? "inline-flex items-center gap-1 rounded-md bg-lagoon/10 px-2 py-1 text-xs font-semibold text-lagoon"
                  : "inline-flex items-center gap-1 rounded-md bg-ink/5 px-2 py-1 text-xs font-semibold text-ink/55"
              }
            >
              {linked ? <CheckCircle2 size={13} aria-hidden="true" /> : null}
              {linked
                ? localize(locale, "Đã liên kết", "Connected")
                : localize(locale, "Chưa liên kết", "Not connected")}
            </span>
          </div>
          <p className="mt-1 break-words text-sm leading-6 text-ink/65">
            {profileUrl ? (
              <a
                className="font-medium text-lagoon underline decoration-lagoon/30 underline-offset-4 transition hover:text-lagoon/80"
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
              >
                {handle}
              </a>
            ) : (
              handle ?? description
            )}
          </p>
          {manualEntry && !linked ? (
            <label className="mt-3 block">
              <span className="sr-only">{localize(locale, `Tên tài khoản ${name}`, `${name} account handle`)}</span>
              <input
                className="h-10 w-full rounded-md border border-ink/15 bg-white px-3 text-sm font-medium text-ink outline-none transition placeholder:text-ink/35 focus:border-lagoon focus:ring-2 focus:ring-lagoon/20"
                type="text"
                value={manualHandle}
                onChange={(event) => setManualHandle(event.target.value)}
                placeholder={localize(locale, "Nhập tên tài khoản", "Enter account handle")}
                disabled={busy}
              />
            </label>
          ) : null}
        </div>

        {linked ? (
          <button
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-coral/25 bg-white px-3 py-2 text-sm font-semibold text-coral transition hover:bg-coral/10 focus:outline-none focus:ring-2 focus:ring-coral/20 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:shrink-0"
            type="button"
            onClick={onDisconnect}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="animate-spin" size={16} aria-hidden="true" />
            ) : (
              <Unlink size={16} aria-hidden="true" />
            )}
            {busy
              ? localize(locale, "Đang gỡ", "Disconnecting")
              : localize(locale, "Gỡ", "Disconnect")}
          </button>
        ) : (
          <button
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white transition hover:bg-ink/90 focus:outline-none focus:ring-2 focus:ring-ink/20 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:shrink-0"
            type="button"
            onClick={handleConnect}
            disabled={busy || (manualEntry && !manualHandleValue)}
          >
            {busy ? (
              <Loader2 className="animate-spin" size={16} aria-hidden="true" />
            ) : (
              <Link2 size={16} aria-hidden="true" />
            )}
            {busy
              ? localize(locale, "Đang liên kết", "Connecting")
              : localize(locale, "Liên kết", "Connect")}
          </button>
        )}
      </div>
    </article>
  );
}
