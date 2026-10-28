# SkillTutor for OpenMatrix Skill: guide for judges

SkillTutor is an AI tutor. It teaches real OpenMatrix Skill courses in 5-minute lessons inside WhatsApp, writes each learner's progress back into the course, and issues skill certificates that anyone can verify.

| | |
| --- | --- |
| 🌐 Live app | https://skilltutor.openmatrixskill.com |
| 💬 WhatsApp agent | **+1 711 885 7804**, opens at https://wa.me/17118857804 |
| ✅ Verify a certificate | https://skilltutor.openmatrixskill.com/verify |
| 💻 Source code | https://github.com/thanhnhaweb3/SkillTutor-for-OpenMatrixSkill (MIT license) |
| 🎬 Demo video (2:42) | `docs/video/SkillTutor-demo-v1.mp4` in the repository |

The app runs on AWS in Sydney (`ap-southeast-2`). It uses AWS End User Messaging Social (WhatsApp), Amazon SNS, End User Messaging SMS, Amazon SES, Amazon Bedrock (Claude Haiku 4.5), Bedrock AgentCore, DynamoDB, Cognito and EventBridge Scheduler.

---

## Option A: Try the live app (about 10 minutes)

### 1. Create an account

1. Open https://skilltutor.openmatrixskill.com and click **Sign in**.
2. Choose **Sign up** in the hosted sign-in page and register with any email address. Sign-in is handled by Amazon Cognito.
3. Confirm the email code. You return to the landing page, which now shows your account panel.

### 2. Join a course

1. On the landing page, scroll to **Featured courses**. The site has two courses:
   - *AI ứng dụng nâng cao trong công việc văn phòng* (Advanced applied AI for office work): 12 lessons.
   - *AI Deployment Practitioner*, about deploying a customer-service AI assistant: 16 lessons, levels L1–L4.
2. Click **Request to join**.
3. Wait for the course Expert to approve your request. Approval is a deliberate part of the product: the Expert stays in control of who is enrolled.
4. After approval, the course appears under **Skill Tutor → My courses**.

> If your request is still waiting, email **thanhnha@olym3.com** with the address you signed up with, and we will approve it.

### 3. Learn on the web

1. Open **My courses** and click **Continue on the web**. The tutor switches to that course and sends the next lesson.
2. Tap the reply buttons under each lesson: **Done ✓**, **Explain more** or **My progress**.
   - **Done** writes your progress into the OMS course. The lesson list in My courses updates: ✓ completed, ▶ up next, ○ not started.
3. Try free-text messages:
   - `remind me at 20:00` sets a daily reminder.
   - `English` or `Tiếng Việt` switches the tutor's language.
4. The **SkillTutor AI** bubble in the corner of every page is a separate assistant. It runs Claude Haiku 4.5 on Amazon Bedrock with tool use over your own course data. It allows 10 AI messages per learner per day.

### 4. Link WhatsApp and continue on your phone

1. Go to **Settings → Connections → Link WhatsApp** to get a one-time code. The code is valid for 15 minutes.
2. Send `LINK 123456` (with your code) to **+1 711 885 7804** on WhatsApp.
   - Because the message arrives from your phone through AWS End User Messaging Social, it proves you own the number. There is no OTP form.
3. The tutor replies with your learning status and buttons. From then on you can use WhatsApp and the web together, with the same conversation, progress and quota:
   - Lessons arrive with the same buttons.
   - **Take the test** starts the certification quiz.
   - **My progress** shows your progress.

### 5. Get and verify a certificate

1. Finish every lesson, then choose **Take the test**.
2. Answer the questions with the list and button replies. Your answers are graded by code, not by the model.
3. When you pass, SkillTutor issues a certificate:
   - a code `OMS-XXXXXXXX`, with the skills and levels you earned;
   - a printable certificate page;
   - a SHA-256 hash of the certificate record.
4. You can verify any certificate in two ways:
   - **On the web:** enter the code at https://skilltutor.openmatrixskill.com/verify.
   - **On WhatsApp:** send the code to +1 711 885 7804. This works from any phone, even one that is not linked, so an employer can check it.

---

## Option B: Message the WhatsApp agent directly

You can message **+1 711 885 7804** (https://wa.me/17118857804) without an account. What happens depends on the message:

| You send | SkillTutor replies |
| --- | --- |
| Any message from an unlinked number | Onboarding text in Vietnamese and English: how to sign in and link WhatsApp |
| `OMS-XXXXXXXX` (a certificate code) | Verification result: the holder, the course, the skills and levels, and whether the hash matches |
| `LINK <code>` | Links the number to your account, then shows your courses with **Next lesson** and **My progress** buttons |

---

## Option C: Run it locally with no AWS account

You need Node.js 20 or later (tested on Node.js 22).

```bash
git clone https://github.com/thanhnhaweb3/SkillTutor-for-OpenMatrixSkill.git
cd SkillTutor-for-OpenMatrixSkill
npm install
# Windows: put these three variables in .env.local instead of prefixing the command
SKILLTUTOR_ENABLED=true SKILLTUTOR_DEMO=true SKILLTUTOR_CRON_SECRET=dev-secret-123456 npm run dev
```

Open http://localhost:3000 and sign in with `jane@ctw.edu.vn` / `password123`. Demo mode enrols this account in a sample cohort.

1. In **Skill Tutor → Learn on the web**, type `study`.
2. Finish the 4 lessons, then type `test` to take the quiz.
3. Open, print and verify the certificate at `/verify/OMS-…`.
4. In **Skill Tutor → Overview** (staff view), you can:
   - see learners at risk of dropping out;
   - run **Drop-out Rescue**;
   - use the WhatsApp/SMS **Simulator**, which shows outbound messages without sending them.

Run the tests (146 tests in total):

```bash
npm run test:skilltutor && npm run test:dashboard && npm run test:ac-login && npm run test:vi-en
```

The full production setup is in the README and in `docs/DEPLOY-VERCEL.md`. Every environment variable is documented in `docs/skilltutor.env.example`.

---

## Where AWS Communication Developer Services are used in the code

| Service | Purpose | Code |
| --- | --- | --- |
| AWS End User Messaging Social (`@aws-sdk/client-socialmessaging`) | WhatsApp lessons, buttons, lists, templates | `packages/skilltutor/src/channels/whatsapp.ts` |
| Amazon SNS | Inbound WhatsApp and SMS events and delivery receipts. Signatures are verified. | `packages/skilltutor/src/next/handlers.ts`, `packages/skilltutor/src/sns.ts` |
| AWS End User Messaging SMS (`@aws-sdk/client-pinpoint-sms-voice-v2`) | SMS fallback and day-5 drop-out nudge | `packages/skilltutor/src/channels/sms.ts` |
| Amazon SES (`@aws-sdk/client-sesv2`) | Certificate email and day-7 comeback plan | `packages/skilltutor/src/channels/email.ts` |
| Amazon Bedrock and Bedrock AgentCore | Claude Haiku 4.5 tutor with tool use | `packages/skilltutor/src/agent/` |

## Known limits

- **Expert approval:** a new learner must be approved by the course Expert before the course appears in My courses.
- **WhatsApp messaging window:** outside the 24-hour customer-service window, WhatsApp only allows approved templates. If the bot seems silent, send any message first, and it will reply.
- **AI message quota:** each learner can send 10 AI messages per day on each channel. The count resets at 00:00 Asia/Ho_Chi_Minh. Button taps, course switches and quiz starts do not count.
- **Quiet hours:** automated reminders are not sent between 21:00 and 08:00 Asia/Ho_Chi_Minh. Replies to your own messages are always sent.

Contact: **thanhnha@olym3.com**. OLYM3 Co., Ltd.
