# @openmatrix/skilltutor

SkillTutor is the AI tutor of **OpenMatrix Skill (OMS)**. It teaches published OMS courses in 5-minute lessons over **WhatsApp**, **SMS**, **email** and the **web**, writes progress back into the course, and issues skill certificates anyone can verify. It was built by OLYM3 for the AWS Communication Developer Services (CDS) Agentic AI Partner Hackathon.

The package holds the tutor itself (agent, tools, channels, store) plus the Next.js route handlers the app mounts under `/api/skilltutor/*`. It reads courses, cohorts and enrolments from the OMS core (`@openmatrix/dashboard`) and records progress through `DeliveryService`, so OMS permissions, feature flags and the audit log always apply.

---

## Contents

1. [Features](#features)
2. [How a learner goes through a course](#how-a-learner-goes-through-a-course)
3. [Architecture](#architecture)
4. [Bilingual support](#bilingual-support)
5. [Course manifests and seeding](#course-manifests-and-seeding)
6. [Module map](#module-map)
7. [Route handlers](#route-handlers)
8. [Configuration](#configuration)
9. [AWS setup](#aws-setup)
10. [Local demo (no AWS)](#local-demo-no-aws)
11. [Tests](#tests)

---

## Features

### Learning

- **Lessons where learners already are.** The next lesson of the active course arrives in WhatsApp, SMS or the browser, with reply buttons *Done ✓ / Explain more / My progress*.
- **Progress written into OMS.** *Done* calls `DeliveryService.completeLesson`, which records `progress:lesson_complete` / `progress:course_complete` in the OMS audit log.
- **Several courses at once.** Learners can list their enrolments and switch the active course; the tutor remembers which one it is teaching.
- **Explain more.** The tutor re-explains the current lesson with a workplace example, staying inside the lesson material.
- **Daily study reminders.** "remind me at 20:00" / "nhắc 20:00" sets a daily reminder, sent in the hour chosen if the learner has not studied that day (WhatsApp for linked phones, otherwise email); "off" turns it off.
- **Progress report by email** through Amazon SES on request.

### Assessment and certificates

- **Certification quiz** when a course reaches 100%: up to 6 multiple-choice questions built from the course's learning outcomes. With Bedrock, Claude writes the questions from the course material only; otherwise a rule-based generator is used. Each question set is cached per course version and language.
- **Grading by code.** Answers (A–D) are checked deterministically and never reach the model. The pass mark is `SKILLTUTOR_PASS_SCORE` (default 70%).
- **Verifiable certificates.** Passing issues `OMS-XXXXXXXX` with the skills earned (the highest target proficiency per skill), a SHA-256 hash of the record, a printable page at `/verify/OMS-…` and an email copy. Anyone can verify a code on the web or by messaging it to the bot, even from an unlinked number.

### Channels and accounts

- **WhatsApp linking with one message.** A signed-in learner gets a one-time code (valid 15 minutes) and sends `LINK 123456`. The code proves the OMS session; the inbound message proves the phone.
- **Learn on the web.** The same rules-based conversation as WhatsApp, continued in the browser with the same history and quota.
- **SkillTutor AI.** A floating assistant on every page with its own conversation, answered by Claude on Amazon Bedrock with tool use over the learner's own course data.
- **Daily AI quota.** 10 messages per learner per day by default, counted per channel with an atomic DynamoDB counter and reset at 00:00 in `SKILLTUTOR_TIME_ZONE`. Quiz answers, course switches and language switches are free. A failed Bedrock call is refunded and explained to the learner.

### Retention

- **Drop-out rescue.** An hourly job nudges inactive linked learners up a ladder:
  - day 3: WhatsApp (free text inside the 24-hour window, else the approved template);
  - day 5: SMS;
  - day 7: email with a comeback plan.

  No messages are sent outside 08:00–21:00 in `SKILLTUTOR_TIME_ZONE`, and comebacks are recorded.

### For Experts and staff

- **Course catalogue.** Active cohorts of the Experts in `SKILLTUTOR_PUBLIC_EXPERT_IDS` are listed publicly with lessons, minutes, skills and each visitor's status (guest / none / pending / rejected / enrolled / closed).
- **Join links and learner approval.** Each cohort has a join link. Join requests are approved or rejected by staff, or learners are admitted directly by email (up to 50 at a time). Admitted learners are invited into the Expert, enrolled and emailed.
- **Expert team.** Staff approve an existing account as Expert staff by email (reviewer, auditor, instructor, curriculum manager or expert admin; reviewer is the default, e.g. for hackathon judges) and remove it again:
  - removing drops only the staff roles, so a learner keeps learning; a member with no other role is suspended and can be re-approved later with just the new role;
  - you cannot remove yourself, a platform admin or the last Expert admin, and only Expert admins can grant Expert admin.
- **Roster and overview.** Per-learner progress, channel, certificate and enrolment date; linked learners, lessons delivered, pass rate, certificates, nudges and learners at risk.
- **WhatsApp diagnostics.** Send a test message to your own number and see the AWS result and the Meta delivery receipts (sent / delivered / read / failed, with error codes).
- **Simulator.** A dry-run WhatsApp/SMS console for trying flows without a phone (only in `dryrun` channel mode).

---

## How a learner goes through a course

1. **Enrol.** Request to join from the landing page or a join link, or be admitted by email.
2. **Link.** `/settings/connections` → *Link WhatsApp* → send `LINK 123456` from the phone.
3. **Learn.** Send "study" / "học" → `get_next_lesson` delivers the next lesson with buttons.
4. **Record.** *Done* → `complete_lesson` → `DeliveryService.completeLesson` (only when `progressEnabledFor(expertId)` is on).
5. **Test.** At 100%, "test" / "thi" → `start_assessment`; answers via buttons → `submit_answer`.
6. **Certify.** On a pass, the certificate is issued, emailed and verifiable at `/verify/OMS-…`.
7. **Come back.** Inactive learners get the rescue ladder; learners with a reminder get a daily nudge.

---

## Architecture

```
 WhatsApp / SMS ── AWS End User Messaging ── Amazon SNS ──► webhooks ─┐
 Browser (Learn on the web, SkillTutor AI) ──────────────────────────┤
                                                                      ▼
                                   inbound.ts: link codes, certificate codes, language switch,
                                   quick replies, quota ──► agent (local or AgentCore Runtime)
                                                                      │
                     10 tools (agent/tools.ts) ◄──────────────────────┘
                        │                    │
       localized OMS gateway        channels: WhatsApp · SMS · SES email
       (oms/localized.ts → oms/gateway.ts → OMS DeliveryService, courses, skills)
                        │
       store.ts: tutor state, links, codes (TTL), threads, quiz sets, certificates,
                 join requests, usage counters, events (DynamoDB single table)
```

**Two conversations.** WhatsApp/SMS and *Learn on the web* share one thread, run by a rules engine by default (`SKILLTUTOR_PHONE_ENGINE=rules`, no AI cost). The SkillTutor AI bubble has its own thread, run by Claude (`SKILLTUTOR_LLM_MODE=bedrock`). Progress and certificates are shared; messages are not.

**The 10 tools:** `get_my_learning`, `switch_course`, `get_next_lesson`, `explain_lesson`, `complete_lesson`, `start_assessment`, `submit_answer`, `send_progress_email`, `set_study_reminder`, `verify_certificate`.

**Agent runtime.** `runAgent` runs in-process (`SKILLTUTOR_AGENT_MODE=local`) or on Amazon Bedrock AgentCore Runtime (`agentcore`), with the same code served by `agentcore/server.ts`.

**Bedrock.** Claude Haiku 4.5 by default, through the Anthropic Messages API on `InvokeModel` (`SKILLTUTOR_BEDROCK_API=messages`) or the Converse API (`converse`), with retries, timeouts and optional prompt caching.

---

## Bilingual support

| Layer | How it works |
| --- | --- |
| Web UI | Strings live in `src/i18n/messages.ts` of the app; API errors are translated by code (`apiErrorText`). The EN/VI selector saves the language to the OMS profile. |
| Tutor messages | `src/i18n.ts` catalogue; replies follow `TutorState.locale`, synced from the OMS profile on every signed-in request. Learners can also type `English` or `Tiếng Việt`. Unknown numbers get bilingual instructions. |
| Quiz, certificate email, nudges, WhatsApp template | Generated or chosen per learner language; quiz sets are cached as `<courseVersionId>#vi` / `#en`. |
| **Course content** | A bilingual course pairs both languages in each OMS text field. `pickLang(text, locale)` in `src/bilingual.ts` returns the reader's half; single-language text is returned unchanged. |

**Bilingual course text formats** (stored as-is in OMS):
- Short fields (titles, module and skill names, outcomes, cohort names): `"English text / Văn bản tiếng Việt"`. The split is the last ` / ` with no Vietnamese letters before it and Vietnamese after it, so slashes inside the English half ("orders / sessions") are kept.
- Lesson summaries: an `ENGLISH` block followed by a `TIẾNG VIỆT` block.

**Where it is applied:**
- **Server:** `localizeGateway(gateway, locale)` (`src/oms/localized.ts`) wraps the OMS gateway, so the tutor's lessons, explanations, quiz material, menus, rescue nudges and reminders are in the learner's language. The admission email uses `pickLang` too.
- **Client:** the app imports `@openmatrix/skilltutor/bilingual` (no server dependencies) on the landing page, My courses, Join, Certificates, Verify, Settings and Learners pages. Text re-renders immediately when the language is switched.
- **Certificates** store the original bilingual course and skill names, so `/verify` shows them in the viewer's language.

---

## Course manifests and seeding

`npm run seed:course` (`scripts/seed-course.ts` → `src/oms/course-seed.ts`) imports a manifest into OMS through the domain services:

```bash
npm run seed:course -- docs/courses/<manifest>.json --author <email> --reviewer <email> \
  [--learner <email>]... [--expert <expertId>] [--tier pro] [--commit]
```

- **Dry run by default.** It validates the manifest and prints the plan; add `--commit` to write.
- **Steps:** it reuses the Expert's first proficiency framework if it has every level the course uses (otherwise it creates the manifest's framework). The author creates and submits the skills and the course, and the reviewer approves and publishes them. It then creates the cohort and admits the learners.
- **Idempotent.** Published skills, the published course, an active cohort with the same name and existing enrolments are reused.
- **Plan limits.** The free plan allows one published course and one active cohort per Expert, and this is checked before any write. `--tier pro` moves the author and reviewer to the pro plan.
- **Author and reviewer must be different accounts** (OMS two-person review). The reviewer is added to the Expert with the reviewer role if needed.

**OMS field limits:**

| Field | Limit |
| --- | --- |
| Course, module and lesson titles | 160 |
| Lesson summary | 4,000 |
| Course and skill descriptions | 4,000 |
| Outcome statement | 500 |
| Skill name | 120 |
| Skill tag | 32 (at most 10 tags) |
| Cohort name | 120 |

**Courses shipped in `docs/courses/`:**

| Manifest | Code | Language |
| --- | --- | --- |
| `ai-van-phong-nang-cao.json` | `AIVP-ADV-01` | Vietnamese, 12 lessons |
| `ai-deployment-practitioner-cham-soc-khach-hang.json` | `AIDP-CS-01` | Vietnamese, 16 lessons, L1–L4 |
| `applying-data-and-ai-in-business-en-vi-45min.json` | `DATA-AI-BIZ-45-ENVI` | English + Vietnamese, 9 lessons |
| `ai-and-iot-engineering-en-vi-45min.json` | `AI-IOT-ENG-45-ENVI` | English + Vietnamese, 9 lessons |

---

## Module map

| File | Role |
| --- | --- |
| `src/runtime.ts` | Builds the runtime (config, gateway, store, LLM, channel sender); lazy OMS repositories; demo seeding |
| `src/config.ts` | Environment-driven configuration |
| `src/inbound.ts` | Entry point for every message: `LINK` codes, certificate codes, language switch, quick replies, quota, agent call, reply |
| `src/agent/agent.ts` | Agent loop (plan → tool → observe → answer), local or AgentCore |
| `src/agent/tools.ts` | The 10 tools and the WhatsApp menus |
| `src/agent/llm.ts` | Bedrock clients (Messages API and Converse), mock LLM for tests and demo |
| `src/oms/gateway.ts` | `OmsLearningGateway`: enrolments, lessons, cohorts, roster, skill names, admission, Expert team, progress writes |
| `src/oms/localized.ts` | Per-learner view of the gateway with bilingual text reduced to one language |
| `src/oms/admission.ts` | Admit a learner: invite → activate membership → enrol through `DeliveryService` |
| `src/oms/team.ts` | Expert team: add/remove staff roles through `MembershipService` |
| `src/oms/quiz.ts` | Quiz generation (Bedrock or rules), cached per course version and language |
| `src/oms/course-seed.ts` | Manifest validation and seeding |
| `src/oms/demo.ts` | In-memory demo Expert, course, cohort and learners |
| `src/bilingual.ts` | `pickLang` / `splitBilingual` (also exported as `@openmatrix/skilltutor/bilingual`) |
| `src/linking.ts` | One-time link codes, redeem, unlink |
| `src/certificates.ts` | Issue (SHA-256 hash) and verify certificates |
| `src/rescue.ts` | Drop-out rescue ladder and daily study reminders |
| `src/limits.ts` | Daily AI quota per learner and channel |
| `src/channels/*` | WhatsApp (`@aws-sdk/client-socialmessaging`), SMS (`@aws-sdk/client-pinpoint-sms-voice-v2`), email (`@aws-sdk/client-sesv2`), dry-run outbox |
| `src/sns.ts` | SNS signature verification |
| `src/store.ts` | In-memory or DynamoDB single-table store (`DYNAMODB_SKILLTUTOR_TABLE`) |
| `src/i18n.ts` | Tutor message catalogue (vi/en) |
| `src/next/*` | Next.js route handlers (below) |
| `agentcore/` | AgentCore Runtime server (`/ping`, `/invocations`) and arm64 Dockerfile |

**Changes to the existing OMS core:** two optional repository methods, `DeliveryRepository.listEnrollmentsByUser` and `DashboardRepository.listMembershipsByExpert` (memory, JSON and DynamoDB implementations). The lesson summary limit in OMS course validation was raised from 2,000 to 4,000 characters for bilingual lessons.

---

## Route handlers

Exported from `@openmatrix/skilltutor/next` and mounted by the app under `src/app/api/skilltutor/*`:

| Route | Handler | Who |
| --- | --- | --- |
| `POST webhooks/whatsapp`, `webhooks/sms` | `createWhatsAppWebhookHandler`, `createSmsWebhookHandler` | Amazon SNS (signature-verified) |
| `GET/POST link` | `createLinkHandlers` | Signed-in learner |
| `GET catalog`, `GET me`, `GET courses` | `createCatalogHandler`, `createMeHandler`, `createMyCoursesHandler` | Public / signed-in learner |
| `GET/POST join` | `createJoinHandlers` | Signed-in learner |
| `GET/POST learn` | `createLearnHandlers` | Signed-in learner (WhatsApp thread on the web) |
| `GET assistant`, `GET/POST assistant/chat` | `createAssistantInfoHandler`, `createAssistantChatHandlers` | Public info / signed-in user |
| `GET certificates/[code]` | `createCertificateVerifyHandler` | Public |
| `GET overview`, `POST rescue/run`, `GET/POST simulator` | `createOverviewHandler`, `createRescueRunHandler`, `createSimulatorHandlers` | Expert staff |
| `GET/POST admin/learners` | `createLearnerAdminHandlers` | Expert admin (`expert:manage_members`) |
| `GET/POST admin/team` | `createTeamAdminHandlers` | Expert admin (`expert:manage_members`) |
| `GET/POST admin/whatsapp` | `createWhatsAppDiagnosticsHandlers` | Expert staff |
| `POST cron/rescue` | `createRescueCronHandler` | EventBridge Scheduler (`x-cron-secret`) |

Cookie-authenticated mutations require an `Origin` header equal to the app origin (CSRF check). When `SKILLTUTOR_ENABLED` is not `true`, every route returns `503 SKILLTUTOR_DISABLED`.

---

## Configuration

Full reference with comments: [`docs/skilltutor.env.example`](../../docs/skilltutor.env.example).

| Variable | Default | Notes |
| --- | --- | --- |
| `SKILLTUTOR_ENABLED` | `false` | Master switch |
| `SKILLTUTOR_DEMO` | `false` | In-memory demo OMS data |
| `SKILLTUTOR_DEFAULT_LOCALE` | `en` | For profiles without a language and unknown numbers |
| `SKILLTUTOR_TIME_ZONE` | `Asia/Ho_Chi_Minh` | Quiet hours, reminders, quota reset |
| `SKILLTUTOR_PUBLIC_EXPERT_IDS` | | Comma-separated Expert ids listed on the landing page |
| `SKILLTUTOR_LLM_MODE` | `mock` | `bedrock` for Claude |
| `SKILLTUTOR_PHONE_ENGINE` | `rules` | `bedrock` to run the WhatsApp/web-learn thread on Claude too |
| `SKILLTUTOR_BEDROCK_MODEL_ID` | Claude Haiku 4.5 inference profile | `us.` in US regions, `global.` elsewhere |
| `SKILLTUTOR_BEDROCK_API` | `messages` | or `converse` |
| `SKILLTUTOR_BEDROCK_REGION`, `_MAX_TOKENS`, `_TEMPERATURE`, `_TOP_P`, `_TOP_K`, `_STOP_SEQUENCES`, `_TIMEOUT_MS`, `_MAX_ATTEMPTS`, `_PROMPT_CACHE` | | Bedrock tuning |
| `SKILLTUTOR_DAILY_MESSAGE_LIMIT` | `10` | Per learner per day; per channel: `_LIMIT_WEB`, `_LIMIT_WHATSAPP`, `_LIMIT_SMS`, `_LIMIT_SIMULATOR` (0 = unlimited) |
| `SKILLTUTOR_AGENT_MODE` | `local` | `agentcore` with `SKILLTUTOR_AGENTCORE_RUNTIME_ARN` |
| `SKILLTUTOR_CHANNELS_MODE` | `dryrun` | `live` to call AWS; the simulator only works in `dryrun` |
| `SKILLTUTOR_WHATSAPP_PHONE_NUMBER_ID` | | `phone-number-id-…` from End User Messaging Social |
| `SKILLTUTOR_WHATSAPP_DISPLAY_NUMBER` | | E.164 number shown on the link page |
| `SKILLTUTOR_WHATSAPP_META_API_VERSION` | `v25.0` | |
| `SKILLTUTOR_WHATSAPP_NUDGE_TEMPLATE` | `skilltutor_comeback` | Approved template; `_TEMPLATE_LANG` (`vi`), `_TEMPLATE_LANG_EN` (`en`), `_TEMPLATE_PARAMS` (`name,lesson`) |
| `SKILLTUTOR_SMS_ORIGINATION_IDENTITY`, `_DISPLAY_NUMBER`, `_CONFIGURATION_SET` | | End User Messaging SMS |
| `SKILLTUTOR_SES_FROM_EMAIL`, `SKILLTUTOR_SES_CONFIGURATION_SET` | | Sender on an SES-verified domain |
| `SKILLTUTOR_STORE` | `memory` | `dynamodb` with `DYNAMODB_SKILLTUTOR_TABLE` (keys `pk`/`sk`, TTL on `ttl`) |
| `SKILLTUTOR_CRON_SECRET` | | At least 16 characters; sent as `x-cron-secret` |
| `SKILLTUTOR_VERIFY_SNS` | `true` | SNS signature verification |
| `SKILLTUTOR_PASS_SCORE` | `0.7` | Quiz pass mark |

**OMS settings SkillTutor depends on:**
- `DASHBOARD_STORE=dynamodb` with the dashboard and audit tables. Membership changes (admission, Expert team) need it.
- `DASHBOARD_PROGRESS_ENABLED=true` and `DASHBOARD_DELIVERY_CANARY_EXPERT_IDS` (ids or `*`) for every Expert whose progress SkillTutor records.

Check a deployment with `npm run check:skilltutor-readiness` and `npm run check:bedrock`.

---

## AWS setup

1. **WhatsApp:** link the WABA in AWS End User Messaging Social, point its event destination to an SNS topic, and subscribe `https://<app>/api/skilltutor/webhooks/whatsapp` with raw message delivery **off**.
2. **SMS:** enable two-way SMS to an SNS topic and subscribe `/api/skilltutor/webhooks/sms`.
3. **Email:** verify the sending domain in Amazon SES.
4. **DynamoDB:** `npm run setup:aws-tables` (or `setup:skilltutor-dynamodb` for the SkillTutor table only).
5. **Bedrock:** enable Anthropic model access (use-case form and Marketplace subscription) and grant `bedrock:InvokeModel`.
6. **Scheduler:** create an EventBridge Scheduler rule `rate(1 hour)` that POSTs `/api/skilltutor/cron/rescue` with the `x-cron-secret` header.
7. **AgentCore (optional):** build `agentcore/Dockerfile` (arm64), push it to ECR, create the agent runtime, and set `SKILLTUTOR_AGENT_MODE=agentcore`.

---

## Local demo (no AWS)

```bash
# from the repository root; on Windows put these in .env.local
SKILLTUTOR_ENABLED=true SKILLTUTOR_DEMO=true SKILLTUTOR_CRON_SECRET=dev-secret-123456 npm run dev
```

1. Sign in as `jane@ctw.edu.vn` / `password123`. In demo mode Jane is a learner and instructor of the Expert "CTW Academy".
2. **Skill Tutor → Learn on the web:** type `study`, finish the lessons, take the test with `test`, and set a reminder with `remind me at 20:00`.
3. Or link a phone in the simulator: get a code at `/settings/connections`, then send `LINK <code>` from **Overview → Simulator**.
4. **Run Drop-out Rescue** on the Overview to see how the demo learners Bảo (4 days inactive) and Hà (9 days inactive) are nudged.
5. Switch the language with the EN/VI selector.

---

## Tests

```bash
npm run test:skilltutor
```

56 tests cover:
- account linking (one-time codes, onboarding for unlinked numbers);
- full courses through to the certificate, including the 16-lesson AI Deployment Practitioner course and the free-plan guard;
- learner approval, join links, the catalogue, My courses;
- the Expert team: approve a judge, remove, re-add, learners keep their learner role;
- bilingual courses: splitting rules, the localized gateway, Vietnamese-only courses unchanged;
- thread separation and daily quota;
- Anthropic request/response mapping and Bedrock error handling;
- SNS signature checks (including rejecting raw deliveries), and WhatsApp/SMS event parsing.
