import {
  createCourseRepository,
  createDashboardRepository,
  createDeliveryRepository,
  createSkillRepository
} from "@openmatrix/dashboard";
import { progressEnabledFor } from "@openmatrix/dashboard/next";
import { createUserStore, loadAcConfig } from "@openmatrix/oms-ac-login";
import { BedrockAnthropicLlm, BedrockLlm, MockLlm, type BedrockParams, type Llm } from "./agent/llm";
import { awsChannelSender, type ChannelSender } from "./channels";
import { loadSkillTutorConfig, type SkillTutorConfig } from "./config";
import { createDemoOms, demoLearners } from "./oms/demo";
import { OmsLearningGateway, type LearningGateway } from "./oms/gateway";
import { DynamoDbSkillTutorStore, InMemorySkillTutorStore, type SkillTutorStore } from "./store";

export interface SkillTutorRuntime {
  config: SkillTutorConfig;
  store: SkillTutorStore;
  gateway: LearningGateway;
  /** Claude on Bedrock (or the mock in demo mode): the SkillTutor AI chat, quiz generation. */
  llm: Llm;
  /** Rule-based intent router for the WhatsApp/SMS thread and "Learn on the web" (no AI cost). */
  rulesLlm: Llm;
  sender: ChannelSender;
  now: () => Date;
  /** Demo mode only: enroll the signed-in web user into the seeded demo Expert/cohort. */
  onSessionUser?: (user: { id: string; name: string; email?: string; locale?: "vi" | "en" }) => Promise<void>;
}

/** Seeds tutor state + phone links for the demo learners that have a phone (rescue demo). */
export async function seedDemoTutor(rt: SkillTutorRuntime) {
  const now = rt.now().getTime();
  for (const l of demoLearners) {
    if (!l.phone || (await rt.store.getState(l.id))) continue;
    await rt.store.putLink({ phone: l.phone, userId: l.id, channel: "whatsapp", linkedAt: new Date(now - 20 * 86_400_000).toISOString() });
    await rt.store.putState({ userId: l.id, name: l.name, email: l.email, locale: "vi", phone: l.phone, preferredChannel: "whatsapp",
      lastActiveAt: new Date(now - l.inactiveDays * 86_400_000).toISOString(), rescue: { stage: 0, nudgedSinceActive: false } });
  }
}

/** Builds OMS repositories on first use, so a disabled/misconfigured SkillTutor never breaks route loading. */
function lazyGateway(factory: () => LearningGateway): LearningGateway {
  let instance: LearningGateway | undefined;
  const get = () => (instance ??= factory());
  return {
    getUser: (...a) => get().getUser(...a),
    listEnrollments: (...a) => get().listEnrollments(...a),
    getCourseVersion: (...a) => get().getCourseVersion(...a),
    getLessons: (...a) => get().getLessons(...a),
    completeLesson: (...a) => get().completeLesson(...a),
    skillNames: (...a) => get().skillNames(...a),
    resolveContext: (...a) => get().resolveContext(...a),
    isMember: (...a) => get().isMember(...a),
    findUserByEmail: (...a) => get().findUserByEmail(...a),
    listCohorts: (...a) => get().listCohorts(...a),
    listRoster: (...a) => get().listRoster(...a),
    admit: (...a) => get().admit(...a),
    listTeam: (...a) => get().listTeam(...a),
    addTeamMember: (...a) => get().addTeamMember(...a),
    removeTeamMember: (...a) => get().removeTeamMember(...a)
  };
}

export function createSkillTutorRuntime(overrides: Partial<SkillTutorRuntime> = {}): SkillTutorRuntime {
  const config = overrides.config ?? loadSkillTutorConfig();
  const demo = !overrides.gateway && config.demo ? createDemoOms() : null;
  const gateway = overrides.gateway ?? (demo
    ? new OmsLearningGateway({ ...demo, progressEnabled: () => true })
    : lazyGateway(() => new OmsLearningGateway({
        users: createUserStore(loadAcConfig()),
        dashboard: createDashboardRepository(),
        courses: createCourseRepository(),
        delivery: createDeliveryRepository(),
        skills: createSkillRepository(),
        progressEnabled: progressEnabledFor,
        defaultLocale: config.defaultLocale
      })));
  return {
    config,
    gateway,
    store: overrides.store ?? (config.storeMode === "dynamodb"
      ? new DynamoDbSkillTutorStore({ region: config.region, tableName: config.tableName })
      : new InMemorySkillTutorStore()),
    llm: overrides.llm ?? createLlm(config),
    rulesLlm: overrides.rulesLlm ?? new MockLlm(),
    sender: overrides.sender ?? awsChannelSender(config),
    now: overrides.now ?? (() => new Date()),
    onSessionUser: overrides.onSessionUser ?? demo?.enrollDemoUser
  };
}

/** Bedrock inference parameters from SKILLTUTOR_BEDROCK_* (no credentials: the SDK reads AWS_ACCESS_KEY_ID/… itself). */
export function bedrockParams(config: SkillTutorConfig): BedrockParams {
  return { modelId: config.bedrockModelId, ...config.bedrock };
}

export function createLlm(config: SkillTutorConfig): Llm {
  if (config.llmMode !== "bedrock") return new MockLlm();
  return config.bedrock.api === "converse" ? new BedrockLlm(bedrockParams(config)) : new BedrockAnthropicLlm(bedrockParams(config));
}

const g = globalThis as unknown as { __skilltutor?: Promise<SkillTutorRuntime> };

/** Process-wide runtime (one per server instance). */
export function getSkillTutorRuntime(): Promise<SkillTutorRuntime> {
  g.__skilltutor ??= (async () => {
    const rt = createSkillTutorRuntime();
    if (rt.config.demo) await seedDemoTutor(rt);
    return rt;
  })();
  return g.__skilltutor;
}
