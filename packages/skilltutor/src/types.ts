/**
 * `web` = SkillTutor AI, the floating chat bubble (Claude on Amazon Bedrock).
 * `app` = "Learn on the web": the learner's WhatsApp conversation continued in the browser (rules engine, no phone needed).
 */
export type Channel = "whatsapp" | "sms" | "email" | "simulator" | "web" | "app";
export type MessagingChannel = Exclude<Channel, "email">;

/**
 * Conversations are kept apart per thread: the SkillTutor AI web bot (floating chat + "Learn on the web")
 * never sees WhatsApp/SMS messages and vice versa. The simulator stands in for WhatsApp.
 */
export type ChatThread = "web" | "phone";
export const PHONE_CHANNELS: Channel[] = ["whatsapp", "sms", "simulator", "app"];
export const threadOf = (channel: Channel): ChatThread => (channel === "web" ? "web" : "phone");
export const threadChannels = (channel: Channel): Channel[] => (threadOf(channel) === "web" ? ["web"] : PHONE_CHANNELS);

export interface InteractiveOptions {
  header?: string;
  options: { id: string; title: string }[];
}

/** Phone ↔ OMS user binding, created when the learner sends `LINK <code>` from their phone. */
export interface ChannelLink {
  phone: string; // E.164
  userId: string;
  channel: MessagingChannel;
  linkedAt: string;
}

export interface LinkCode {
  code: string;
  userId: string;
  expiresAt: string;
}

export interface QuizQuestion {
  id: string;
  lessonId: string;
  prompt: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
  explanation: string;
}

export interface QuizSet {
  courseVersionId: string;
  generatedBy: "bedrock" | "rules";
  questions: QuizQuestion[];
  createdAt: string;
}

export interface QuizSession {
  expertId: string;
  cohortId: string;
  courseVersionId: string;
  /** Quiz set key: courseVersionId + locale (questions are generated per language). */
  quizKey?: string;
  index: number;
  correct: number;
  startedAt: string;
}

/** Tutor-side state. OMS stays the system of record for enrollments and progress. */
export interface TutorState {
  userId: string;
  name: string;
  email?: string;
  locale: "vi" | "en";
  phone?: string;
  preferredChannel: MessagingChannel;
  lastActiveAt: string;
  lastWhatsAppInboundAt?: string;
  active?: { expertId: string; cohortId: string };
  currentLessonId?: string;
  activeQuiz?: QuizSession;
  /** Daily study reminder, "HH:MM" in the tutor time zone. */
  reminderTime?: string;
  /** Local date (YYYY-MM-DD) of the last reminder sent. */
  lastReminderOn?: string;
  rescue: { stage: 0 | 1 | 2 | 3; lastNudgeAt?: string; nudgedSinceActive: boolean };
}

export interface ChatMessage {
  userId: string;
  at: string;
  direction: "in" | "out";
  channel: Channel;
  text: string;
  interactive?: InteractiveOptions;
}

export interface CertificateSkill {
  skillId: string;
  name: string;
  proficiency: string;
}

export interface TutorCertificate {
  code: string;
  userId: string;
  learnerName: string;
  expertId: string;
  expertName: string;
  courseId: string;
  courseTitle: string;
  courseVersionId: string;
  skills: CertificateSkill[];
  score: number;
  issuedAt: string;
  /** SHA-256 over the canonical payload, anchorable on-chain */
  hash: string;
}

export type TutorEventType =
  | "linked"
  | "daily_limit"
  | "agent_error"
  | "webhook_rejected"
  | "join_requested"
  | "learner_admitted"
  | "join_rejected"
  | "team_added"
  | "team_removed"
  | "wa_sent"
  | "wa_failed"
  | "wa_status"
  | "message_in"
  | "message_out"
  | "lesson_delivered"
  | "lesson_completed"
  | "quiz_started"
  | "quiz_passed"
  | "quiz_failed"
  | "certificate_issued"
  | "nudge_sent"
  | "reactivated"
  | "reminder_set"
  | "reminder_sent";

export interface TutorEvent {
  id: string;
  at: string;
  type: TutorEventType;
  userId: string;
  expertId?: string;
  channel?: Channel;
  data?: Record<string, unknown>;
}

export interface OutboundMessage {
  channel: Channel;
  to: { phone?: string; email?: string };
  text: string;
  subject?: string;
  html?: string;
  interactive?: InteractiveOptions;
  template?: { name: string; language: string; params: string[] };
  /** Language for channel chrome (e.g. WhatsApp list button). */
  locale?: "vi" | "en";
}

export type OutboxItem = OutboundMessage & { id: string; at: string; userId: string };

/** A learner asking to join a cohort via the course's join link; an Expert admin approves or rejects it. */
export interface JoinRequest {
  expertId: string;
  cohortId: string;
  userId: string;
  name: string;
  email?: string;
  note?: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  decidedAt?: string;
  decidedBy?: string;
}
