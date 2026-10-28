"use client";

import { useState } from "react";
import type { ConnectProviderId, SupportedLocale } from "../../core/types";
import { useAcAuthContext } from "../AcLoginProvider";
import { localize } from "../i18n";

interface EthereumProvider {
  request<T = unknown>(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<T>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function useAcConnections(locale: SupportedLocale = "vi") {
  const { user, refresh } = useAcAuthContext();
  const [busyProvider, setBusyProvider] = useState<ConnectProviderId | null>(null);

  async function link(provider: ConnectProviderId, handle?: string) {
    setBusyProvider(provider);

    if (handle !== undefined) {
      try {
        const response = await fetch(`/api/ac/connect/${provider}/manual`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle })
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          window.alert(data?.error ?? localize(locale, "Không thể lưu tài khoản mạng xã hội.", "Could not save the social account."));
          return;
        }

        await refresh();
      } finally {
        setBusyProvider(null);
      }
      return;
    }

    if (provider === "metamask") {
      try {
        if (!window.ethereum) {
          window.alert(localize(locale, "Vui lòng cài đặt hoặc mở MetaMask để liên kết ví.", "Install or open MetaMask to connect your wallet."));
          return;
        }

        const accounts = await window.ethereum.request<string[]>({
          method: "eth_requestAccounts"
        });
        const address = accounts[0];

        if (!address) {
          window.alert(localize(locale, "MetaMask chưa trả về địa chỉ ví.", "MetaMask did not return a wallet address."));
          return;
        }

        const response = await fetch("/api/ac/connect/metamask/wallet", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address })
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          window.alert(
            data?.error === "identity_already_linked"
              ? "identity_already_linked or Disconnect All Dapp in your Metamask to reconnect"
              : data?.error ?? localize(locale, "Không thể lưu địa chỉ ví MetaMask.", "Could not save the MetaMask address.")
          );
          return;
        }

        await refresh();
      } finally {
        setBusyProvider(null);
      }
      return;
    }

    window.location.href = `/api/ac/connect/${provider}/login?returnUrl=/settings/connections`;
  }

  async function unlink(provider: ConnectProviderId) {
    setBusyProvider(provider);
    await fetch(`/api/ac/connect/${provider}/unlink`, {
      method: "POST",
      credentials: "include"
    });
    await refresh();
    setBusyProvider(null);
  }

  return {
    connections: user?.connections,
    busyProvider,
    link,
    unlink,
    refresh
  };
}
