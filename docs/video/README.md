# SkillTutor – demo video

| File | What it is |
| --- | --- |
| **`SkillTutor-demo-v1.mp4`** | **Use this one.** 1920×1080, 30 fps, **2:42** (fits the 3-minute review window), H.264 + AAC 48 kHz. English voice-over (neural TTS) and burned-in English subtitles, loudness normalised to −16 LUFS. 19 MB |
| `SkillTutor-demo-v1.en.srt` | The same subtitles as a separate file (optional; only needed if you upload a version without burned-in subtitles) |
| `SkillTutor-demo.mp4` / `SkillTutor-demo.en.srt` | v0: silent version with caption bars (2:33). Kept for reference |
| `README.md` | Upload steps, storyboard, narration, and a script for re-shooting on production |

Repository: https://github.com/thanhnhaweb3/SkillTutor-for-OpenMatrixSkill

## 1. Upload to YouTube (required: YouTube only)

1. Go to studio.youtube.com, then **Create → Upload videos**, and choose `SkillTutor-demo-v1.mp4`.
2. **Title:** `SkillTutor for OpenMatrix Skill – AI tutor on WhatsApp (AWS CDS Agentic AI Hackathon)`
3. **Description:**
   ```
   SkillTutor teaches real OpenMatrix Skill courses in 5-minute lessons inside WhatsApp, records progress in the course and issues verifiable skill certificates.
   Built with AWS End User Messaging Social (WhatsApp), End User Messaging SMS, Amazon SES, Amazon Bedrock (Claude Haiku 4.5, Anthropic Messages API, tool use), Bedrock AgentCore, DynamoDB and Cognito.
   Live: https://skilltutor.openmatrixskill.com
   Code: https://github.com/thanhnhaweb3/SkillTutor-for-OpenMatrixSkill
   ```
4. **Audience:** "No, it's not made for kids".
5. **Subtitles:** v1 already has subtitles burned into the picture, so there is nothing to upload. Don't add the .srt as well, or viewers who turn on CC will see the text twice.
6. **Visibility:** **Unlisted** or **Public**, with no password. Copy the link into Devpost → *Demo video URL*.

## 2. Storyboard (v1)

| Time | Scene | Voice-over / subtitle |
| --- | --- | --- |
| 0:00 | Title card | SkillTutor for OpenMatrix Skill: an AI tutor that teaches real courses inside WhatsApp. |
| 0:08 | Problem → solution, AWS services | Busy employees start online courses and rarely finish them. SkillTutor brings each 5-minute lesson to WhatsApp, records progress in the course and certifies the skill. |
| 0:20 | Landing → course → **Request to join** | A learner finds a real OpenMatrix Skill course and requests to join the cohort. |
| 0:30 | Admin **Approve** → roster | The Expert's admin approves the request, and the learner is enrolled. |
| 0:39 | Settings → **Link WhatsApp** → `LINK` code | To learn on WhatsApp, the learner gets a one-time LINK code. |
| 0:46 | WhatsApp: link → lesson → Done → quiz → certificate | Every WhatsApp message goes through AWS End User Messaging Social. Sending the code from the phone links it to the OMS account. The learner then gets a micro-lesson with reply buttons. Tapping Done records progress straight into the OpenMatrix Skill course. After the last lesson, the certification quiz starts. Answers are graded by the agent's tools, not guessed by the model. Pass, and a verifiable skill certificate is issued. |
| 1:29 | Learn on the web (same thread) | "Learn on the web" shows the same WhatsApp conversation in the browser. |
| 1:41 | SkillTutor AI chat bubble | SkillTutor AI is a separate assistant chat, with 10 AI messages per learner per day. |
| 1:53 | `npm run check:bedrock` output | In production it runs on Claude Haiku 4.5 on Amazon Bedrock, through the Anthropic Messages API, with tool use. |
| 2:03 | Certificate verification | Employers verify any certificate: the record is checked against its SHA-256 hash. |
| 2:11 | Architecture diagram | Next.js on Vercel, End User Messaging for WhatsApp and SMS, SES, Bedrock and AgentCore, DynamoDB and Cognito. |
| 2:22 | Code: AWS calls at runtime | AWS is called at runtime: SendWhatsAppMessage, SNS webhooks and InvokeModel on Bedrock. |
| 2:34 | End card with links | Try SkillTutor at skilltutor.openmatrixskill.com. Thank you! |

How it was made:
- **Web scenes:** real screen recordings of the app, driven step by step, on a production build with the demo dataset (CTW Academy demo course, sample learners). The link code, lessons, quiz and certificate were all produced by the app during the recording.
- **WhatsApp scene:** rendered from the exact messages the app sent through the `SendWhatsAppMessage` path in a dry-run session. An on-screen note says so.
- **AI chat scene:** recorded in demo mode, also noted on screen. The next card shows the real Bedrock output from `npm run check:bedrock`.
- **Voice:** generated offline with the open-source Piper TTS engine, voice *en_US lessac medium*. That voice was trained on the Lessac Blizzard 2013 dataset, which has its own licence (https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html). Check it before any commercial use, or replace the voice with your own recording using the narration column above.

## 3. Re-shoot on production later (stronger version)

Do this once the WhatsApp inbound path is fixed (EUM Social → SNS → webhook in the Sydney account). It replaces the rendered phone and demo-mode scenes with the real thing.

| # | Shot (≤ 3:00 total) | How |
| --- | --- | --- |
| 1 | 0:00–0:10 title | Reuse `c01` title card, or just say it over the landing page |
| 2 | 0:10–0:30 | skilltutor.openmatrixskill.com → sign in with Cognito → **Request to join** |
| 3 | 0:30–0:45 | Admin account → *Learners* tab → **Approve** |
| 4 | 0:45–1:00 | Settings → **Link WhatsApp** → tap *Open WhatsApp* on the phone → send `LINK 123456` |
| 5 | 1:00–1:50 | **Phone screen recording** (Android: Screen recorder; iPhone: Control Center → Screen Recording): lesson with buttons → *Done ✓* → *Get certified* → answer → certificate |
| 6 | 1:50–2:10 | Web: *Learn on the web* (same thread), then the **SkillTutor AI** bubble: ask "Explain few-shot prompting with an example" — real Claude answer, footer shows *Claude (Haiku 4.5) · Amazon Bedrock* |
| 7 | 2:10–2:25 | `/verify/OMS-…` with the real certificate code |
| 8 | 2:25–2:50 | Architecture diagram + one line per AWS service |

Tips: set the browser to 1920×1080 and zoom to 125%. Use Windows **Win + Alt + R** (Xbox Game Bar) or OBS to record, keep each shot short, and cut with Clipchamp.
