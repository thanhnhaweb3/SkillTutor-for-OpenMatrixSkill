import assert from "node:assert/strict";
import test from "node:test";
import { applyLearnerProfile, isIsoCountryCode, normalizeCountryCode, validateLearnerProfilePatch } from "../src/core/profile";
import { toPublicUser } from "../src/core/identity-link";
import type { AcUser } from "../src/core/types";
import type { AcConfig } from "../src/core/types";
import { createSessionToken, SESSION_COOKIE } from "../src/core/session";
import { createAcHandlers } from "../src/next/create-handlers";
import { JsonUserStore } from "../src/store/json-user-store";
import { NextRequest } from "next/server";

const user: AcUser = {
  id: "user-profile", email: "learner@example.com", name: "Learner", role: "learner", avatarInitials: "LE",
  primaryAdapter: "cognito", primarySubject: "subject", identities: [],
  createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z"
};

test("legacy user defaults to English and unset country disclosure", () => {
  const result = toPublicUser(user);
  assert.equal(result.locale, "en");
  assert.equal(result.countryDisclosure, "unset");
  assert.equal(result.countryCode, undefined);
});

test("normalizes and validates ISO country codes", () => {
  assert.equal(normalizeCountryCode(" vn "), "VN");
  assert.equal(isIsoCountryCode("US"), true);
  assert.throws(() => normalizeCountryCode("Vietnam"), /INVALID_COUNTRY/);
  assert.throws(() => normalizeCountryCode("XX"), /INVALID_COUNTRY/);
});

test("profile patch rejects unknown and inconsistent fields", () => {
  assert.deepEqual(validateLearnerProfilePatch({ locale: "en", countryDisclosure: "provided", countryCode: "vn" }), {
    locale: "en", countryDisclosure: "provided", countryCode: "VN"
  });
  assert.throws(() => validateLearnerProfilePatch({ locale: "fr", countryDisclosure: "unset" }), /INVALID_LOCALE/);
  assert.throws(() => validateLearnerProfilePatch({ locale: "vi", countryDisclosure: "declined", countryCode: "VN" }), /VALIDATION_ERROR/);
  assert.throws(() => validateLearnerProfilePatch({ locale: "vi", countryDisclosure: "unset", role: "admin" }), /VALIDATION_ERROR/);
});

test("declining country removes a previously provided country", () => {
  const provided = applyLearnerProfile(user, { locale: "en", countryDisclosure: "provided", countryCode: "VN" }, "2026-07-21T01:00:00.000Z");
  assert.equal(provided.countryCode, "VN");
  const declined = applyLearnerProfile(provided, { locale: "vi", countryDisclosure: "declined" }, "2026-07-21T02:00:00.000Z");
  assert.equal(declined.countryCode, undefined);
  assert.equal(declined.countryDisclosure, "declined");
  assert.equal(declined.locale, "vi");
});

const config: AcConfig = {
  appUrl: "https://dashboard.example.test",
  primaryAdapter: "cognito",
  sessionSecret: "test-secret-with-enough-entropy",
  sessionMaxAgeSec: 3600,
  userStorePath: "/tmp/unused-profile-test.json",
  localDataStorage: false,
  allowConnectWithoutSession: false,
  connect: { opencampus: false, github: false, metamask: false, x: false, linkedin: false, facebook: false, google: false },
  features: { connectedAccountsConsole: true, credentialsGallery: true, legacyRouteAlias: false, profileMutations: true }
};

function profileRequest(body: unknown, origin = config.appUrl) {
  const token = createSessionToken(user.id, config.sessionSecret, config.sessionMaxAgeSec, user);
  return new NextRequest(`${config.appUrl}/api/ac/profile`, {
    method: "PATCH",
    headers: { origin, "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify(body)
  });
}

test("profile handler updates session-only profile and locale cookie", async () => {
  const previous = process.env.AC_USER_STORE;
  process.env.AC_USER_STORE = "session";
  try {
    const handler = createAcHandlers({ config, store: new JsonUserStore(config.userStorePath) });
    const response = await handler.profileUpdate(profileRequest({ locale: "en", countryDisclosure: "provided", countryCode: "vn" }));
    assert.equal(response.status, 200);
    const body = await response.json() as { user: { locale: string; countryCode: string; countryDisclosure: string } };
    assert.deepEqual(body.user, { ...body.user, locale: "en", countryCode: "VN", countryDisclosure: "provided" });
    assert.match(response.headers.get("set-cookie") ?? "", /oms-locale=en/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  } finally {
    if (previous === undefined) delete process.env.AC_USER_STORE; else process.env.AC_USER_STORE = previous;
  }
});

test("profile handler rejects cross-origin and unknown security fields", async () => {
  const previous = process.env.AC_USER_STORE;
  process.env.AC_USER_STORE = "session";
  try {
    const handler = createAcHandlers({ config, store: new JsonUserStore(config.userStorePath) });
    const crossOrigin = await handler.profileUpdate(profileRequest({ locale: "vi", countryDisclosure: "unset" }, "https://evil.example"));
    assert.equal(crossOrigin.status, 403);
    const invalid = await handler.profileUpdate(profileRequest({ locale: "vi", countryDisclosure: "unset", role: "admin" }));
    assert.equal(invalid.status, 422);
  } finally {
    if (previous === undefined) delete process.env.AC_USER_STORE; else process.env.AC_USER_STORE = previous;
  }
});
