import { AcError } from "../core/errors";
import type { PrimaryAuthAdapter } from "./types";
import type { UserStore } from "../store/user-store";

export function localPrimaryAdapter(store: UserStore): PrimaryAuthAdapter {
  return {
    id: "local",
    displayName: "Local Email",
    buildLoginUrl({ returnUrl }) {
      return `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
    },
    buildLogoutUrl(returnUrl) {
      return returnUrl;
    },
    async handleLocalLogin(input) {
      const user = await store.findByEmail(input.email);
      if (!user || user.password !== input.password) {
        throw new AcError("invalid_credentials", 401);
      }

      return {
        subject: user.primarySubject,
        email: user.email,
        name: user.name
      };
    }
  };
}
