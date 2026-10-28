import { AcError } from "./errors";
import type { AcUser, CountryDisclosure, LearnerProfilePatch, SupportedLocale } from "./types";

/** Language for visitors and accounts that have not chosen one. */
export const DEFAULT_LOCALE: SupportedLocale = "en";
export const SUPPORTED_LOCALES = ["vi", "en"] as const;

// ISO 3166-1 alpha-2, versioned in source. XK is intentionally excluded because it is not an official assignment.
export const ISO_COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(" ");
const ISO_ALPHA_2 = new Set(ISO_COUNTRY_CODES);

export function normalizeLocale(value: unknown): SupportedLocale {
  return value === "en" || value === "vi" ? value : DEFAULT_LOCALE;
}

export function normalizeCountryDisclosure(value: unknown): CountryDisclosure {
  return value === "provided" || value === "declined" ? value : "unset";
}

export function normalizeCountryCode(value: unknown) {
  if (typeof value !== "string") throw new AcError("INVALID_COUNTRY", 422);
  const code = value.trim().toUpperCase();
  if (!ISO_ALPHA_2.has(code)) throw new AcError("INVALID_COUNTRY", 422);
  return code;
}

export function validateLearnerProfilePatch(input: unknown): LearnerProfilePatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AcError("VALIDATION_ERROR", 422);
  const body = input as Record<string, unknown>;
  const allowed = new Set(["locale", "countryDisclosure", "countryCode"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new AcError("VALIDATION_ERROR", 422);
  if (body.locale !== "vi" && body.locale !== "en") throw new AcError("INVALID_LOCALE", 422);
  if (body.countryDisclosure !== "provided" && body.countryDisclosure !== "declined" && body.countryDisclosure !== "unset") {
    throw new AcError("VALIDATION_ERROR", 422);
  }
  if (body.countryDisclosure === "provided") {
    return { locale: body.locale, countryDisclosure: "provided", countryCode: normalizeCountryCode(body.countryCode) };
  }
  if (body.countryCode !== undefined) throw new AcError("VALIDATION_ERROR", 422);
  return { locale: body.locale, countryDisclosure: body.countryDisclosure };
}

export function applyLearnerProfile(user: AcUser, patch: LearnerProfilePatch, now = new Date().toISOString()): AcUser {
  const updated: AcUser = {
    ...user,
    locale: patch.locale,
    countryDisclosure: patch.countryDisclosure,
    countryUpdatedAt: now,
    updatedAt: now
  };
  if (patch.countryDisclosure === "provided") updated.countryCode = patch.countryCode;
  else delete updated.countryCode;
  return updated;
}

export function isIsoCountryCode(value: string) {
  return ISO_ALPHA_2.has(value);
}
