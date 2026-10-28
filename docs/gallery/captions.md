# Devpost image gallery – captions

1500 × 1000 px (3:2), PNG, each well under 5 MB. Upload in this order and paste the caption for each.

| File | Caption |
| --- | --- |
| 01-landing.png | Learn a new skill in 5 minutes a day, right inside WhatsApp. |
| 02-signed-in-landing.png | Your account: WhatsApp link status, enrolled courses with progress, certificates. |
| 03-course-catalogue.png | Real cohorts from OpenMatrix Skill; request to join, admin approves. |
| 04-whatsapp-lesson.png | Micro-lesson with reply buttons (Done ✓ / Explain more / My progress) sent through AWS End User Messaging Social. |
| 05-whatsapp-quiz.png | Certification quiz with list/button answers; graded by the agent's tools, not by the model. |
| 06-skilltutor-ai-chat.png | Claude Haiku 4.5 on Amazon Bedrock answers open questions, 10 AI messages per learner per day. |
| 07-learn-on-the-web.png | The same WhatsApp conversation, continued in the browser. |
| 08-learner-approval.png | Experts approve join requests or add learners by email. |
| 09-certificate-verification.png | OMS-XXXXXXXX code + SHA-256 hash, verifiable by employers on the web or via WhatsApp. |
| 10-architecture.png | SkillTutor architecture on AWS (2800 × 1867, padded to 3:2). |

Notes
- Screens were captured from the app's demo dataset (CTW Academy demo course, sample learners).
- 04 and 05 are rendered from the exact message payloads the app sent with `SendWhatsAppMessage` during a dry-run session; button titles are cut at 20 characters as WhatsApp does.
- 06 shows the assistant configured for Amazon Bedrock before the first question; a screenshot with a live Claude answer can be taken on production.
