import type { PrimaryAdapterId, PrimaryAuthResult } from "../core/types";

export interface PrimarySignUpInput {
  email: string;
  name: string;
  password: string;
}

export interface PrimaryConfirmSignUpInput {
  email: string;
  code: string;
}

export interface PrimaryResendSignUpCodeInput {
  email: string;
}

export interface PrimarySignUpResult {
  userConfirmed: boolean;
  delivery?: {
    destination?: string;
    medium?: string;
  };
}

export interface PrimaryAuthAdapter {
  id: PrimaryAdapterId;
  displayName: string;
  handleLocalLogin?(input: { email: string; password: string }): Promise<PrimaryAuthResult>;
  handleCallback?(request: Request): Promise<PrimaryAuthResult>;
  handleSignUp?(input: PrimarySignUpInput): Promise<PrimarySignUpResult>;
  handleConfirmSignUp?(input: PrimaryConfirmSignUpInput): Promise<void>;
  handleResendSignUpCode?(input: PrimaryResendSignUpCodeInput): Promise<PrimarySignUpResult>;
  buildLoginUrl(opts: { returnUrl: string; org?: string; provider?: string }): string;
  buildLogoutUrl(returnUrl: string): string;
}
