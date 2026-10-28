/** SkillTutor runtime configuration (env driven, same conventions as the rest of OMS). */
const env = (key: string, fallback = "") => process.env[key]?.trim() || fallback;
const num = (key: string, fallback: number) => { const v = Number(env(key)); return env(key) !== "" && Number.isFinite(v) ? v : fallback; };
const optNum = (key: string) => (env(key) === "" || !Number.isFinite(Number(env(key))) ? undefined : Number(env(key)));

export function loadSkillTutorConfig() {
  return {
    enabled: env("SKILLTUTOR_ENABLED") === "true",
    /** Seeded in-memory OMS (expert, course, cohort, enrollment for the local demo user). */
    demo: env("SKILLTUTOR_DEMO") === "true",
    region: env("AWS_REGION", "us-east-1"),
    /** Language for learners whose OMS profile has none, and for unknown numbers. */
    defaultLocale: (env("SKILLTUTOR_DEFAULT_LOCALE", "en") === "vi" ? "vi" : "en") as "vi" | "en",
    appUrl: env("NEXT_PUBLIC_APP_URL", env("APP_URL", "http://localhost:3000")),

    /** mock = local rules (no AWS call); bedrock = Claude on Amazon Bedrock. */
    llmMode: (env("SKILLTUTOR_LLM_MODE", "mock") as "mock" | "bedrock"),
    /** Cross-region inference profile: "us." only works from US regions; elsewhere the global profile is the default. */
    bedrockModelId: env("SKILLTUTOR_BEDROCK_MODEL_ID", `${env("SKILLTUTOR_BEDROCK_REGION", env("AWS_REGION", "us-east-1")).startsWith("us-") ? "us" : "global"}.anthropic.claude-haiku-4-5-20251001-v1:0`),
    /**
     * Engine for the WhatsApp/SMS conversation and "Learn on the web": rules = structured learning flow without AI cost;
     * bedrock = Claude as well. The floating SkillTutor AI chat always uses SKILLTUTOR_LLM_MODE.
     */
    phoneEngine: (env("SKILLTUTOR_PHONE_ENGINE", "rules") === "bedrock" ? "bedrock" : "rules") as "rules" | "bedrock",
    bedrock: {
      /** messages = Anthropic Messages API via InvokeModel (native Claude body); converse = Bedrock Converse API. */
      api: (env("SKILLTUTOR_BEDROCK_API", "messages") === "converse" ? "converse" : "messages") as "messages" | "converse",
      /** Region of the Bedrock runtime endpoint (defaults to AWS_REGION). */
      region: env("SKILLTUTOR_BEDROCK_REGION", env("AWS_REGION", "us-east-1")),
      anthropicVersion: env("SKILLTUTOR_BEDROCK_ANTHROPIC_VERSION", "bedrock-2023-05-31"),
      maxTokens: num("SKILLTUTOR_BEDROCK_MAX_TOKENS", 800),
      temperature: optNum("SKILLTUTOR_BEDROCK_TEMPERATURE") ?? 0.3,
      /** Claude 4.5+ accepts temperature OR top_p, not both: setting TOP_P drops temperature. */
      topP: optNum("SKILLTUTOR_BEDROCK_TOP_P"),
      topK: optNum("SKILLTUTOR_BEDROCK_TOP_K"),
      stopSequences: env("SKILLTUTOR_BEDROCK_STOP_SEQUENCES").split("|").map((x) => x.trim()).filter(Boolean),
      timeoutMs: num("SKILLTUTOR_BEDROCK_TIMEOUT_MS", 25000),
      /** Total attempts incl. the first one (SDK retries throttling/5xx with backoff). */
      maxAttempts: num("SKILLTUTOR_BEDROCK_MAX_ATTEMPTS", 3),
      /** Anthropic prompt caching on the system prompt + tools (cheaper repeat calls; only applies above the model's minimum prompt size). */
      promptCache: env("SKILLTUTOR_BEDROCK_PROMPT_CACHE") === "true",
    },
    /**
     * Messages per learner per day that reach the AI agent, counted separately per channel (0 = unlimited).
     * Quiz answers (A–D), language and course switches don't count. The day resets at 00:00 in SKILLTUTOR_TIME_ZONE.
     */
    dailyLimits: {
      web: num("SKILLTUTOR_DAILY_LIMIT_WEB", num("SKILLTUTOR_DAILY_MESSAGE_LIMIT", 10)),
      whatsapp: num("SKILLTUTOR_DAILY_LIMIT_WHATSAPP", num("SKILLTUTOR_DAILY_MESSAGE_LIMIT", 10)),
      sms: num("SKILLTUTOR_DAILY_LIMIT_SMS", num("SKILLTUTOR_DAILY_MESSAGE_LIMIT", 10)),
      /** Staff testing tool: unlimited unless set. */
      simulator: num("SKILLTUTOR_DAILY_LIMIT_SIMULATOR", 0),
    } as Record<"web" | "whatsapp" | "sms" | "simulator", number>,
    agentMode: (env("SKILLTUTOR_AGENT_MODE", "local") as "local" | "agentcore"),
    agentRuntimeArn: env("SKILLTUTOR_AGENTCORE_RUNTIME_ARN"),

    channelsMode: (env("SKILLTUTOR_CHANNELS_MODE", "dryrun") as "dryrun" | "live"),
    whatsapp: {
      originationPhoneNumberId: env("SKILLTUTOR_WHATSAPP_PHONE_NUMBER_ID"),
      /** Public display number shown on the link page, E.164 */
      displayNumber: env("SKILLTUTOR_WHATSAPP_DISPLAY_NUMBER"),
      /** Meta Graph API version. v20.0 expired on 2026-09-24; v25.0 is supported until 2028-07-29. */
      metaApiVersion: env("SKILLTUTOR_WHATSAPP_META_API_VERSION", "v25.0"),
      nudgeTemplate: env("SKILLTUTOR_WHATSAPP_NUDGE_TEMPLATE", "skilltutor_comeback"),
      /** Language codes exactly as the approved template versions in WhatsApp Manager (e.g. vi, en, en_US). */
      templateLanguage: env("SKILLTUTOR_WHATSAPP_TEMPLATE_LANG", "vi"),
      templateLanguageEn: env("SKILLTUTOR_WHATSAPP_TEMPLATE_LANG_EN", "en"),
      /** Body variables of the template, in order: {{1}}, {{2}}… Allowed: name, lesson, course, minutes. Empty = template without variables. */
      templateParams: env("SKILLTUTOR_WHATSAPP_TEMPLATE_PARAMS", "name,lesson").split(",").map((x) => x.trim()).filter(Boolean),
    },
    sms: {
      originationIdentity: env("SKILLTUTOR_SMS_ORIGINATION_IDENTITY"),
      displayNumber: env("SKILLTUTOR_SMS_DISPLAY_NUMBER"),
      configurationSet: env("SKILLTUTOR_SMS_CONFIGURATION_SET"),
    },
    email: {
      from: env("SKILLTUTOR_SES_FROM_EMAIL", "OpenMatrix Skill <tutor@openmatrixskill.com>"),
      configurationSet: env("SKILLTUTOR_SES_CONFIGURATION_SET"),
    },

    /** Experts whose active cohorts are listed on the public landing page (comma-separated ids, "*" not supported). */
    publicExpertIds: env("SKILLTUTOR_PUBLIC_EXPERT_IDS").split(",").map((x) => x.trim()).filter(Boolean),
    storeMode: (env("SKILLTUTOR_STORE", "memory") as "memory" | "dynamodb"),
    tableName: env("DYNAMODB_SKILLTUTOR_TABLE", "skilltutor"),

    cronSecret: env("SKILLTUTOR_CRON_SECRET"),
    verifySns: env("SKILLTUTOR_VERIFY_SNS", "true") !== "false",
    passScore: Number(env("SKILLTUTOR_PASS_SCORE", "0.7")),
    linkCodeTtlMinutes: 15,
    timeZone: env("SKILLTUTOR_TIME_ZONE", "Asia/Ho_Chi_Minh"),
  };
}

export type SkillTutorConfig = ReturnType<typeof loadSkillTutorConfig>;
