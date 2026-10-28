"use client";

import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogIn,
  MailCheck,
  ShieldCheck,
  Sparkles,
  UserPlus
} from "lucide-react";
import type { SupportedLocale } from "../core/types";
import { localize } from "./i18n";

type LoginMode = "signin" | "signup" | "confirm";

interface SignUpResponse {
  ok: boolean;
  userConfirmed: boolean;
  delivery?: {
    destination?: string;
    medium?: string;
  };
  error?: string;
  message?: string;
}

const errorLabels: Record<string, [string, string]> = {
  CodeMismatchException: ["Mã xác nhận không đúng.", "The confirmation code is incorrect."],
  ExpiredCodeException: ["Mã xác nhận đã hết hạn.", "The confirmation code has expired."],
  InvalidPasswordException: ["Mật khẩu chưa đạt chính sách của Cognito.", "The password does not meet the Cognito policy."],
  InvalidParameterException: ["Thông tin đăng ký chưa hợp lệ.", "The registration details are invalid."],
  NotAuthorizedException: ["App client chưa cho phép thao tác này.", "The app client does not allow this operation."],
  UsernameExistsException: ["Email này đã được đăng ký.", "This email is already registered."],
  UserNotFoundException: ["Không tìm thấy email đang chờ xác nhận.", "No pending account was found for this email."],
  adapter_misconfigured: ["Cognito adapter chưa được cấu hình đầy đủ.", "The Cognito adapter is not fully configured."],
  invalid_request: ["Vui lòng nhập đủ thông tin.", "Complete all required fields."]
};

function labelError(code: string, locale: SupportedLocale) {
  const labels = errorLabels[code];
  return labels ? localize(locale, labels[0], labels[1]) : code;
}

function providerErrorMessage(code: string | undefined, message: string | undefined, locale: SupportedLocale) {
  if (!code) return "signup_failed";

  if (message) {
    if (code === "InvalidParameterException" && message.includes("phone_number")) {
      return localize(locale, "Cognito User Pool đang bắt buộc phone_number. App đã tắt gửi SMS, nên bạn cần đổi User Pool sang required email-only hoặc tạo User Pool mới không bắt buộc phone.", "The Cognito User Pool requires phone_number while the app has disabled SMS. Change the pool to require email only, or create a pool that does not require a phone number.");
    }

    return `${labelError(code, locale)} ${message}`;
  }

  return labelError(code, locale);
}

export function AcLoginPage({ locale = "vi" }: { locale?: SupportedLocale }) {
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") ?? "/settings/connections";
  const loginUrl = useMemo(
    () => `/api/ac/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`,
    [returnUrl]
  );

  const [mode, setMode] = useState<LoginMode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [delivery, setDelivery] = useState<string | null>(null);
  const [deliveryMedium, setDeliveryMedium] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(searchParams.get("error"));
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const codeDestination = delivery ?? (pendingEmail || email);
  const isSmsDelivery = deliveryMedium?.toUpperCase() === "SMS";

  function switchMode(nextMode: LoginMode) {
    setMode(nextMode);
    setError(null);
    setNotice(null);
  }

  async function onSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    if (password !== confirmPassword) {
      setError(localize(locale, "Mật khẩu nhập lại chưa khớp.", "The passwords do not match."));
      setLoading(false);
      return;
    }

    const response = await fetch("/api/ac/auth/signup", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password })
    });
    const data = (await response.json()) as SignUpResponse;

    if (!response.ok) {
      setError(providerErrorMessage(data.error, data.message, locale));
      setLoading(false);
      return;
    }

    if (data.userConfirmed) {
      setNotice(localize(locale, "Tài khoản đã được tạo. Bạn có thể đăng nhập ngay.", "Your account was created. You can sign in now."));
      setMode("signin");
    } else {
      setPendingEmail(email.trim().toLowerCase());
      setDelivery(data.delivery?.destination ?? null);
      setDeliveryMedium(data.delivery?.medium ?? null);
      setMode("confirm");
    }

    setLoading(false);
  }

  async function onConfirmSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    const response = await fetch("/api/ac/auth/confirm-signup", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: pendingEmail || email, code })
    });
    const data = (await response.json()) as { ok?: boolean; error?: string; message?: string };

    if (!response.ok) {
      setError(providerErrorMessage(data.error, data.message, locale));
      setLoading(false);
      return;
    }

    setNotice(localize(locale, "Email đã được xác nhận. Bạn có thể đăng nhập bằng Cognito.", "Email confirmed. You can now sign in with Cognito."));
    setMode("signin");
    setLoading(false);
  }

  async function onResendCode() {
    setResending(true);
    setError(null);
    setNotice(null);

    const response = await fetch("/api/ac/auth/resend-signup-code", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: pendingEmail || email })
    });
    const data = (await response.json()) as SignUpResponse;

    if (!response.ok) {
      setError(providerErrorMessage(data.error, data.message, locale));
      setResending(false);
      return;
    }

    setDelivery(data.delivery?.destination ?? delivery);
    setDeliveryMedium(data.delivery?.medium ?? deliveryMedium);
    setNotice(localize(locale, "Đã gửi lại mã xác nhận.", "A new confirmation code was sent."));
    setResending(false);
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:px-6 lg:px-8">
      <section className="mx-auto grid min-h-[calc(100vh-7rem)] w-full max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1fr)_27.5rem]">
        <div className="flex min-w-0 flex-col gap-7">
          <div className="inline-flex w-fit items-center gap-2 rounded-md border border-lagoon/20 bg-white/75 px-3 py-2 text-sm font-semibold text-lagoon shadow-sm">
            <Sparkles size={16} aria-hidden="true" />
            OpenMatrix Skill (OMS)
          </div>

          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold leading-tight text-ink sm:text-5xl">
              OpenMatrix Skill Account
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-ink/70">
              {localize(locale, "Đăng nhập và đăng ký tài khoản OMS bằng AWS Cognito User Pool.", "Sign in or create an OMS account with AWS Cognito User Pool.")}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Cognito User Pool", localize(locale, "Lưu tài khoản chính", "Primary account storage")],
              ["Email verification", localize(locale, "Xác nhận bằng mã email", "Email code confirmation")],
              ["OMS session", localize(locale, "Kết nối vào phiên app", "Application session")]
            ].map(([title, description]) => (
              <div
                key={title}
                className="rounded-lg border border-ink/10 bg-white/80 p-4 shadow-sm"
              >
                <div className="mb-3 h-1.5 w-10 rounded-full bg-lagoon" />
                <p className="text-sm font-semibold text-ink">{title}</p>
                <p className="mt-1 text-sm leading-5 text-ink/60">{description}</p>
              </div>
            ))}
          </div>
        </div>

        <section className="w-full min-w-0 rounded-lg border border-ink/10 bg-white p-4 shadow-panel sm:p-7">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-md bg-lagoon text-white shadow-sm">
              <ShieldCheck size={22} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-2xl font-semibold text-ink">
                {mode === "signup"
                  ? localize(locale, "Đăng ký", "Create account")
                  : mode === "confirm"
                    ? localize(locale, "Xác nhận email", "Confirm email")
                    : localize(locale, "Đăng nhập", "Sign in")}
              </h2>
              <p className="text-sm leading-5 text-ink/65">{localize(locale, "Đăng nhập bằng tài khoản AWS Cognito", "AWS Cognito primary auth")}</p>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-2 rounded-md border border-ink/10 bg-ink/5 p-1">
            <button
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded px-3 py-2 text-sm font-semibold transition ${
                mode === "signin"
                  ? "bg-white text-ink shadow-sm"
                  : "text-ink/60 hover:text-ink"
              }`}
              type="button"
              onClick={() => switchMode("signin")}
            >
              <LogIn className="hidden sm:block" size={16} aria-hidden="true" />
              {localize(locale, "Đăng nhập", "Sign in")}
            </button>
            <button
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded px-3 py-2 text-sm font-semibold transition ${
                mode !== "signin"
                  ? "bg-white text-ink shadow-sm"
                  : "text-ink/60 hover:text-ink"
              }`}
              type="button"
              onClick={() => switchMode("signup")}
            >
              <UserPlus className="hidden sm:block" size={16} aria-hidden="true" />
              {localize(locale, "Đăng ký", "Create account")}
            </button>
          </div>

          {notice ? (
            <div
              className="mb-4 flex gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700"
              role="status"
            >
              <CheckCircle2 className="shrink-0" size={18} aria-hidden="true" />
              <span className="min-w-0 break-words">{notice}</span>
            </div>
          ) : null}

          {error ? (
            <div
              className="mb-4 flex gap-2 rounded-md border border-coral/25 bg-coral/10 px-3 py-2 text-sm text-coral"
              role="alert"
            >
              <AlertCircle className="shrink-0" size={18} aria-hidden="true" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          ) : null}

          {mode === "signin" ? (
            <div className="flex flex-col gap-4">
              <div className="flex gap-3 rounded-md border border-lagoon/15 bg-lagoon/5 px-3 py-3 text-sm text-ink/70">
                <KeyRound
                  className="mt-0.5 shrink-0 text-lagoon"
                  size={17}
                  aria-hidden="true"
                />
                <span>{localize(locale, "Phiên đăng nhập sẽ được xử lý qua Cognito Hosted UI.", "Your sign-in session is handled through Cognito Hosted UI.")}</span>
              </div>

              <a
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-lagoon/90 focus:outline-none focus:ring-2 focus:ring-lagoon/25 focus:ring-offset-2"
                href={loginUrl}
              >
                <LogIn size={18} aria-hidden="true" />
                {localize(locale, "Đăng nhập bằng Cognito", "Sign in with Cognito")}
                <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
          ) : null}

          {mode === "signup" ? (
            <form className="flex flex-col gap-4" onSubmit={onSignUp}>
              <label className="flex flex-col gap-2 text-sm font-medium text-ink">
                {localize(locale, "Tên", "Name")}
                <input
                  className="h-11 rounded-md border border-ink/15 bg-white px-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-lagoon focus:ring-2 focus:ring-lagoon/20"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                />
              </label>

              <label className="flex flex-col gap-2 text-sm font-medium text-ink">
                Email
                <input
                  className="h-11 rounded-md border border-ink/15 bg-white px-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-lagoon focus:ring-2 focus:ring-lagoon/20"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              <label className="flex flex-col gap-2 text-sm font-medium text-ink">
                {localize(locale, "Mật khẩu", "Password")}
                <input
                  className="h-11 rounded-md border border-ink/15 bg-white px-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-lagoon focus:ring-2 focus:ring-lagoon/20"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>

              <label className="flex flex-col gap-2 text-sm font-medium text-ink">
                {localize(locale, "Nhập lại mật khẩu", "Confirm password")}
                <input
                  className="h-11 rounded-md border border-ink/15 bg-white px-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-lagoon focus:ring-2 focus:ring-lagoon/20"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>

              <button
                className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-lagoon/90 focus:outline-none focus:ring-2 focus:ring-lagoon/25 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
                type="submit"
                disabled={loading}
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}
                {loading ? localize(locale, "Đang tạo tài khoản", "Creating account") : localize(locale, "Tạo tài khoản", "Create account")}
              </button>
            </form>
          ) : null}

          {mode === "confirm" ? (
            <form className="flex flex-col gap-4" onSubmit={onConfirmSignUp}>
              <div className="flex gap-3 rounded-md border border-lagoon/15 bg-lagoon/5 px-3 py-3 text-sm text-ink/70">
                <MailCheck
                  className="mt-0.5 shrink-0 text-lagoon"
                  size={17}
                  aria-hidden="true"
                />
                <span>{localize(locale, "Mã xác nhận đã được gửi tới", "A confirmation code was sent to")} {codeDestination}.</span>
              </div>

              {isSmsDelivery ? (
                <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-3 text-sm leading-6 text-amber-800">
                  {localize(locale, "Cognito đang gửi mã qua SMS. Nếu bạn không nhận được tin nhắn, hãy xoá user chưa xác nhận trong Cognito rồi đăng ký lại để app gửi yêu cầu email-only.", "Cognito is sending the code by SMS. If it does not arrive, delete the unconfirmed Cognito user and register again so the app can request email-only delivery.")}
                </div>
              ) : null}

              <label className="flex flex-col gap-2 text-sm font-medium text-ink">
                {localize(locale, "Mã xác nhận", "Confirmation code")}
                <input
                  className="h-11 rounded-md border border-ink/15 bg-white px-3 text-ink outline-none transition placeholder:text-ink/35 focus:border-lagoon focus:ring-2 focus:ring-lagoon/20"
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  required
                />
              </label>

              <button
                className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-lagoon/90 focus:outline-none focus:ring-2 focus:ring-lagoon/25 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
                type="submit"
                disabled={loading}
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <MailCheck size={18} />}
                {loading ? localize(locale, "Đang xác nhận", "Confirming") : localize(locale, "Xác nhận email", "Confirm email")}
              </button>

              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm transition hover:border-lagoon/40 hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
                type="button"
                disabled={resending}
                onClick={onResendCode}
              >
                {resending ? <Loader2 className="animate-spin" size={17} /> : <MailCheck size={17} />}
                {resending ? localize(locale, "Đang gửi lại", "Resending") : localize(locale, "Gửi lại mã", "Resend code")}
              </button>
            </form>
          ) : null}
        </section>
      </section>
    </main>
  );
}
