# Redeploy SkillTutor v0.6.1 lên Vercel

Bản này khớp với video demo (`docs/video/SkillTutor-demo-v1.mp4`): landing page có danh sách khóa học thật → xin tham gia → admin duyệt → liên kết WhatsApp bằng mã `LINK` → học trên WhatsApp / "Learn on the web" → bot **SkillTutor AI** (Claude Haiku 4.5 trên Amazon Bedrock) → chứng chỉ có mã băm SHA-256 → trang xác minh công khai.

Đã kiểm tra trước khi giao:
- 143 test đạt: skilltutor 48, dashboard 87, ac-login 6, vi-en 2.
- `tsc` không lỗi.
- `next build` production chạy được khi không bật demo.

---

## 1. Ba biến phải đúng tuyệt đối

| Biến | Giá trị | Nếu sai |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://skilltutor.openmatrixskill.com` (không có `/` cuối) | Mọi thao tác gửi đi (chat, xin tham gia, liên kết WhatsApp, duyệt học viên) bị từ chối **403 MISSING_PERMISSION** → hộp chat báo "Couldn't send the message" |
| `AC_SESSION_SECRET` | Chuỗi ngẫu nhiên dài, ví dụ `openssl rand -base64 32` | Nếu bỏ trống, app dùng khóa mặc định `dev-change-me` → **không an toàn** |
| `COGNITO_REDIRECT_URI` | `https://skilltutor.openmatrixskill.com/api/ac/auth/callback` | Đăng nhập Cognito lỗi `redirect_mismatch` |

---

## 2. Đẩy code lên GitHub

Repo: https://github.com/thanhnhaweb3/SkillTutor-for-OpenMatrixSkill

```powershell
cd C:\PROJECTS\AWS-CDS-AI\dashboard-oms
git remote -v
# nếu origin vẫn là repo cũ (…-V055):
git remote set-url origin https://github.com/thanhnhaweb3/SkillTutor-for-OpenMatrixSkill.git

git add -A
git status            # KIỂM TRA: không được có .env, .env.old, data/*.json chứa mật khẩu
git commit -m "v0.6.1: SkillTutor AI on Bedrock, WhatsApp thread, daily quota, landing, demo assets"
git push origin main
```

`.gitignore` đã chặn `.env*`. File video `docs/video/*.mp4` (~19 MB và ~17 MB) vẫn dưới giới hạn 100 MB/file của GitHub.

---

## 3. Vercel

1. **Project → Settings → Git:** nếu project còn nối với repo cũ, chọn **Disconnect** rồi **Connect** repo `thanhnhaweb3/SkillTutor-for-OpenMatrixSkill`, branch `main`.
2. **Settings → Environment Variables** (môi trường *Production*): đặt các biến ở mục 4.
3. **Deployments → Redeploy**, bỏ chọn *Use existing build cache*.
4. **Settings → Functions:** để mặc định. Các route chat và webhook đã khai báo `maxDuration = 60` giây, gói Hobby cho phép mức này.

---

## 4. Biến môi trường trên Vercel

Không đưa giá trị secret vào git. Danh sách đầy đủ có chú thích nằm trong `docs/skilltutor.env.example`.

**App & đăng nhập**

```
NEXT_PUBLIC_APP_URL=https://skilltutor.openmatrixskill.com
AC_SESSION_SECRET=<chuỗi ngẫu nhiên>
AC_PRIMARY_ADAPTER=cognito
COGNITO_REGION=ap-southeast-2
COGNITO_USER_POOL_ID=<…>
COGNITO_CLIENT_ID=<…>
COGNITO_CLIENT_SECRET=<…>        # chỉ khi app client có secret; sai → ?error=invalid_client
COGNITO_DOMAIN=<…>.auth.ap-southeast-2.amazoncognito.com
COGNITO_REDIRECT_URI=https://skilltutor.openmatrixskill.com/api/ac/auth/callback
COGNITO_SCOPES=openid email phone
```

**AWS & lưu trữ**

```
AWS_REGION=ap-southeast-2
AWS_ACCESS_KEY_ID=<AKIA…>        # IAM user skilltutor – KHÔNG đặt AWS_SESSION_TOKEN
AWS_SECRET_ACCESS_KEY=<…>
DASHBOARD_STORE=dynamodb
AC_USER_STORE=dynamodb
SKILLTUTOR_STORE=dynamodb
DYNAMODB_DASHBOARD_TABLE=OpenMatrixDashboard
DYNAMODB_DASHBOARD_AUDIT_TABLE=OpenMatrixDashboardAudit
DYNAMODB_USERS_TABLE=OpenMatrixUsers
DYNAMODB_SKILLTUTOR_TABLE=OpenMatrixSkillTutor
```

**SkillTutor**

```
SKILLTUTOR_ENABLED=true
SKILLTUTOR_DEMO=false
SKILLTUTOR_DEFAULT_LOCALE=en
SKILLTUTOR_PUBLIC_EXPERT_IDS=<expertId của khóa "AI ứng dụng nâng cao…">   # để landing hiện cohort thật
DASHBOARD_PROGRESS_ENABLED=true
DASHBOARD_ENROLLMENTS_ENABLED=true
DASHBOARD_MUTATIONS_ENABLED=true
DASHBOARD_DELIVERY_CANARY_EXPERT_IDS=*
SKILLTUTOR_CRON_SECRET=<chuỗi ngẫu nhiên>
```

**Claude trên Bedrock (bot SkillTutor AI)**

```
SKILLTUTOR_LLM_MODE=bedrock
SKILLTUTOR_BEDROCK_API=messages
SKILLTUTOR_BEDROCK_REGION=ap-southeast-2
SKILLTUTOR_BEDROCK_MODEL_ID=global.anthropic.claude-haiku-4-5-20251001-v1:0
SKILLTUTOR_PHONE_ENGINE=rules          # WhatsApp/Learn on the web: luồng có cấu trúc, không tốn phí AI
SKILLTUTOR_DAILY_MESSAGE_LIMIT=50      # 50 tin/ngày/người, mỗi kênh riêng
SKILLTUTOR_TIME_ZONE=Asia/Ho_Chi_Minh
```

**WhatsApp / SMS / Email**

```
SKILLTUTOR_CHANNELS_MODE=live
SKILLTUTOR_WHATSAPP_PHONE_NUMBER_ID=<phone-number-id trong EUM Social, Sydney>
SKILLTUTOR_WHATSAPP_DISPLAY_NUMBER=<số WhatsApp hiển thị, dạng +…>
SKILLTUTOR_WHATSAPP_META_API_VERSION=v25.0
SKILLTUTOR_WHATSAPP_NUDGE_TEMPLATE=skilltutorreminder
SKILLTUTOR_WHATSAPP_TEMPLATE_LANG=en
SKILLTUTOR_WHATSAPP_TEMPLATE_LANG_EN=en
SKILLTUTOR_VERIFY_SNS=true
SKILLTUTOR_SES_FROM_EMAIL=OpenMatrix Skill <tutor@openmatrixskill.com>
```

---

## 5. Kiểm tra AWS (tài khoản 645897840672, Sydney)

- [ ] **IAM user `skilltutor`** có các quyền:
  - `bedrock:InvokeModel` cho inference profile và foundation model Claude Haiku 4.5;
  - `dynamodb:GetItem/PutItem/UpdateItem/DeleteItem/Query` trên 4 bảng (thiếu `UpdateItem` thì hạn mức 10 tin/ngày **không được áp dụng**: app vẫn chạy và chỉ ghi lỗi `skilltutor_usage_write_failed` vào log);
  - `social-messaging:SendWhatsAppMessage`;
  - `sms-voice:SendTextMessage`;
  - `ses:SendEmail`.
- [ ] **Bedrock:** đã gửi biểu mẫu Anthropic use case và đăng ký Marketplace. Chạy `npm run check:bedrock` trên máy phải ra 2 dấu ✓.
- [ ] **WhatsApp nhận tin** (SNS topic `arn:aws:sns:ap-southeast-2:645897840672:SkillTutor`):
  - EUM Social → WhatsApp business account → số điện thoại → **Event destination** = topic `SkillTutor` ở `ap-southeast-2`.
  - Topic có subscription **HTTPS** tới `https://skilltutor.openmatrixskill.com/api/skilltutor/webhooks/whatsapp`, trạng thái **Confirmed**.
  - **Raw message delivery phải TẮT** (SNS → Subscriptions → chọn subscription → *Edit* → bỏ chọn *Enable raw message delivery* → *Save*). Khi bật, SNS bỏ phong bì có chữ ký nên webhook trả `400 SNS_RAW_DELIVERY` và **mọi tin WhatsApp, kể cả `LINK`, đều bị bỏ qua**, dù subscription vẫn hiện *Confirmed*.
  - Kiểm tra: mở `/api/skilltutor/webhooks/whatsapp`. Nếu `problems` có dòng "Webhook is rejecting SNS messages…" thì Raw vẫn đang bật. Có thể dùng thêm `npm run check:whatsapp-link -- <email> <+số>`.
  - Nếu tắt Raw rồi mà vẫn không có tin nào tới (`lastWhatsAppEvent` = null sau khi nhắn), kiểm tra **Access policy** của topic có cho phép dịch vụ EUM Social publish:
    ```json
    { "Sid": "AllowEumSocialPublish", "Effect": "Allow",
      "Principal": { "Service": "social-messaging.amazonaws.com" },
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:ap-southeast-2:645897840672:SkillTutor",
      "Condition": { "StringEquals": { "aws:SourceAccount": "645897840672" } } }
    ```
- [ ] **Khóa học thật:** đã chạy `npm run seed:course`, và `SKILLTUTOR_PUBLIC_EXPERT_IDS` trỏ đúng Expert đó.

---

## 6. Kiểm tra sau khi deploy (theo thứ tự trong video)

| # | Mở | Phải thấy |
| --- | --- | --- |
| 1 | `/api/skilltutor/assistant` | `{"enabled":true,"engine":"bedrock","model":"Haiku 4.5"}` |
| 2 | `/api/skilltutor/webhooks/whatsapp` | `"ok":true`, `"channelsMode":"live"`, `"store":"ok"`, `"region":"ap-southeast-2"` |
| 3 | `/` (chưa đăng nhập) | Landing, mục **Featured course** có cohort thật, nút "Sign in to enroll" |
| 4 | Đăng nhập tài khoản học viên → **Request to join** | "Waiting for Expert approval" |
| 5 | Tài khoản admin → *Skill Tutor → Learners* → **Approve** | Học viên vào *Roster* |
| 6 | *Settings → Connections* → **Link WhatsApp** → gửi `LINK xxxxxx` từ điện thoại | Bot trả lời "🔗 Linked…", trang tự chuyển sang "Linked" |
| 7 | WhatsApp: *Next lesson* → *Done ✓* | Bài học có nút, rồi "✅ Recorded in OMS – progress …%" |
| 8 | *Skill Tutor → Learn on the web* | Cùng cuộc trò chuyện WhatsApp, mỗi tin ghi nguồn |
| 9 | Bong bóng chat góc phải → hỏi "Explain few-shot prompting with an example" | Câu trả lời của Claude; dòng cuối ghi "Claude (Haiku 4.5) · Amazon Bedrock · 9/10 AI messages left today" |
| 10 | `/verify/OMS-…` | "Valid – the data matches its SHA-256 hash" |

Nếu bot AI báo lỗi, câu trả lời sẽ ghi mã lỗi, ví dụ `AccessDeniedException`; tìm `skilltutor_agent_failed` trong Vercel Logs. Nếu hộp chat báo "Couldn't send the message (HTTP 403)", kiểm tra lại `NEXT_PUBLIC_APP_URL`.

---

## 7. Thay đổi trong bản này

- **Sửa CSP:** `next.config.mjs` chỉ cho phép `'unsafe-eval'` ở chế độ dev. Trước đây CSP chặn eval nên `npm run dev` đứng ở "Loading"; bản production vẫn giữ CSP chặt.
- **Landing:** phần "Get started in 4 steps" dùng nền xanh giống phần "Bring your training programme".
- **File mẫu `docs/skilltutor.env.example`:**
  - sửa `NEXT_PUBLIC_APP_URL` và `COGNITO_REDIRECT_URI` sang `skilltutor.openmatrixskill.com` (trước ghi nhầm `tutor.…`);
  - thêm `AC_SESSION_SECRET`.
- **Các phần đã có từ trước, giờ đồng bộ đầy đủ trên máy:**
  - hai luồng chat tách riêng: SkillTutor AI (Bedrock) và WhatsApp / Learn on the web (rules);
  - hạn mức 10 tin/ngày;
  - nhắn lỗi rõ ràng khi Bedrock lỗi;
  - `check:bedrock`, `check:whatsapp-link`.
