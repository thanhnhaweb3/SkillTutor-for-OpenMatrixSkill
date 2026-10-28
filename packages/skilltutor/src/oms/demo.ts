import {
  InMemoryCourseRepository,
  InMemoryDashboardRepository,
  InMemoryDeliveryRepository,
  type Cohort,
  type Course,
  type CourseVersion,
  type Enrollment,
  type Expert,
  type ExpertMembership,
  type LearnerProgress
} from "@openmatrix/dashboard";
import type { AcUser } from "@openmatrix/oms-ac-login";

/**
 * Seeded in-memory OMS used when SKILLTUTOR_DEMO=true (and by tests):
 * one active Expert, a published course whose lessons map to skills, one active cohort and enrollments.
 */
export const DEMO_EXPERT_ID = "expert-demo";
export const DEMO_COHORT_ID = "cohort-demo-oct";
export const DEMO_COURSE_ID = "course-ai-prompting";

const at = "2026-10-01T00:00:00.000Z";
const outcome = (id: string, statement: string, skillId: string, code: string) => ({ id, statement, skillId, skillVersionId: `${skillId}-v1`, targetProficiencyCode: code });

export const demoSkills: Record<string, string> = {
  "skill-prompt-design": "Prompt Design",
  "skill-ai-verification": "AI Output Verification",
  "skill-ai-agents": "AI Agents Fundamentals"
};

export function demoCourseVersion(): CourseVersion {
  return {
    id: "cv-ai-prompting-1", expertId: DEMO_EXPERT_ID, courseId: DEMO_COURSE_ID, versionNumber: 1, status: "published",
    title: "AI Prompting cho người đi làm", description: "Khóa ngắn giúp dùng AI tạo sinh an toàn, hiệu quả trong công việc.", ownerUserId: "author-demo",
    modules: [
      { id: "mod-1", title: "Viết prompt hiệu quả", position: 1, lessons: [
        { id: "lesson-prompt-structure", title: "Cấu trúc một prompt tốt", position: 1, estimatedMinutes: 5,
          summary: "Một prompt rõ ràng gồm vai trò, nhiệm vụ, ngữ cảnh và định dạng đầu ra. Thiếu phần nào, AI sẽ phải đoán phần đó.",
          outcomes: [outcome("o1", "Viết prompt có đủ vai trò, nhiệm vụ, ngữ cảnh và định dạng", "skill-prompt-design", "L2")] },
        { id: "lesson-few-shot", title: "Few-shot: dạy AI bằng ví dụ", position: 2, estimatedMinutes: 5,
          summary: "Đưa 2–3 cặp ví dụ đầu vào → đầu ra mẫu trước khi giao việc thật để AI bắt chước đúng phong cách và cấu trúc.",
          outcomes: [outcome("o2", "Dùng ví dụ mẫu để điều khiển phong cách đầu ra", "skill-prompt-design", "L2")] }
      ] },
      { id: "mod-2", title: "Dùng AI có trách nhiệm", position: 2, lessons: [
        { id: "lesson-verify-output", title: "Kiểm chứng đầu ra của AI", position: 1, estimatedMinutes: 6,
          summary: "AI có thể trả lời tự tin nhưng sai. Luôn yêu cầu nguồn, kiểm tra số liệu quan trọng và hỏi lại AI điểm nào có thể sai.",
          outcomes: [outcome("o3", "Phát hiện và kiểm chứng thông tin sai do AI tạo ra", "skill-ai-verification", "L2")] },
        { id: "lesson-agents-intro", title: "Agent khác chatbot ở đâu", position: 2, estimatedMinutes: 6,
          summary: "Chatbot trả lời; agent hành động: lập kế hoạch, gọi công cụ, quan sát kết quả rồi quyết định bước tiếp theo.",
          outcomes: [outcome("o4", "Phân biệt chatbot và AI agent dùng công cụ", "skill-ai-agents", "L1")] }
      ] }
    ],
    publishedAt: at, publishedBy: "reviewer-demo", version: 1, createdAt: at, createdBy: "author-demo", updatedAt: at, updatedBy: "reviewer-demo"
  };
}

export interface DemoLearner { id: string; name: string; email: string; phone?: string; inactiveDays: number; completed: string[] }

export const demoLearners: DemoLearner[] = [
  { id: "user-demo", name: "Jane Doe", email: "jane@ctw.edu.vn", inactiveDays: 0, completed: [] },
  { id: "user-demo-bao", name: "Trần Quốc Bảo", email: "bao@example.com", phone: "+84901000002", inactiveDays: 4, completed: ["lesson-prompt-structure"] },
  { id: "user-demo-ha", name: "Lê Thu Hà", email: "ha@example.com", phone: "+84901000003", inactiveDays: 9, completed: [] }
];

export function createDemoOms() {
  const expert: Expert = { id: DEMO_EXPERT_ID, slug: "ctw-academy", displayName: "CTW Academy", status: "active", ownerUserId: "author-demo", level: 1, createdAt: at, updatedAt: at, version: 1 };
  const membership = (userId: string, roles: ExpertMembership["roles"]): ExpertMembership => ({ id: `m-${userId}`, expertId: DEMO_EXPERT_ID, userId, status: "active", roles, tier: "pro", createdAt: at, updatedAt: at, version: 1 });
  const version = demoCourseVersion();
  const course: Course = { id: DEMO_COURSE_ID, expertId: DEMO_EXPERT_ID, code: "AIP-101", slug: "ai-prompting", latestVersionId: version.id, latestVersionNumber: 1,
    latestStatus: "published", latestTitle: version.title, latestOwnerUserId: "author-demo", currentPublishedVersionId: version.id, version: 1, createdAt: at, createdBy: "author-demo", updatedAt: at, updatedBy: "reviewer-demo" };
  const cohort: Cohort = { id: DEMO_COHORT_ID, expertId: DEMO_EXPERT_ID, name: "Cohort tháng 10/2026", courseId: course.id, courseVersionId: version.id, courseVersionNumber: 1,
    startDate: "2026-10-01", status: "active", version: 1, createdAt: at, createdBy: "author-demo", updatedAt: at, updatedBy: "author-demo" };
  const required = version.modules.flatMap((m) => m.lessons.map((l) => l.id));
  const enrollments: Enrollment[] = demoLearners.map((l) => ({ id: `enr-${l.id}`, expertId: DEMO_EXPERT_ID, cohortId: cohort.id, courseId: course.id, courseVersionId: version.id,
    userId: l.id, status: "active", enrolledAt: at, enrolledBy: "author-demo", version: 1 }));
  const progress: LearnerProgress[] = demoLearners.map((l) => ({ expertId: DEMO_EXPERT_ID, cohortId: cohort.id, courseId: course.id, courseVersionId: version.id, userId: l.id,
    completedLessonIds: [...l.completed].sort(), requiredLessonCount: required.length, completedLessonCount: l.completed.length,
    percentComplete: Math.floor((l.completed.length * 100) / required.length), version: 1, createdAt: at, updatedAt: at }));

  const users = new Map<string, AcUser>(demoLearners.map((l) => [l.id, {
    id: l.id, email: l.email, name: l.name, role: "learner", avatarInitials: l.name.slice(0, 2).toUpperCase(), primaryAdapter: "local",
    primarySubject: `local:${l.email}`, identities: [], locale: "vi", createdAt: at, updatedAt: at
  } satisfies AcUser]));

  const dashboardData = { experts: [expert], memberships: [...demoLearners.map((l) => membership(l.id, l.id === "user-demo" ? ["learner", "instructor"] : ["learner"])), membership("author-demo", ["expert_admin"])] };
  const delivery = new InMemoryDeliveryRepository({ cohorts: [cohort], enrollments, progress });

  /**
   * Demo only: any signed-in account (local or Cognito) joins the demo Expert as learner + instructor
   * and is enrolled in the demo cohort, so the whole flow can be tried with a real login.
   */
  async function enrollDemoUser(user: { id: string; name: string; email?: string; locale?: "vi" | "en" }) {
    const existing = users.get(user.id);
    if (!existing) users.set(user.id, { id: user.id, email: user.email ?? "", name: user.name, role: "learner", avatarInitials: user.name.slice(0, 2).toUpperCase(),
      primaryAdapter: "local", primarySubject: `demo:${user.id}`, identities: [], locale: user.locale ?? "vi", createdAt: at, updatedAt: at });
    else if (user.locale && existing.locale !== user.locale) users.set(user.id, { ...existing, locale: user.locale });
    if (!dashboardData.memberships.some((m) => m.userId === user.id)) dashboardData.memberships.push(membership(user.id, ["learner", "instructor"]));
    if (!(await delivery.getEnrollment(DEMO_EXPERT_ID, cohort.id, user.id))) {
      const now = new Date().toISOString();
      await delivery.commitCreateEnrollment({
        enrollment: { id: `enr-${user.id}`, expertId: DEMO_EXPERT_ID, cohortId: cohort.id, courseId: course.id, courseVersionId: version.id, userId: user.id, status: "active", enrolledAt: now, enrolledBy: "demo", version: 1 },
        progress: { expertId: DEMO_EXPERT_ID, cohortId: cohort.id, courseId: course.id, courseVersionId: version.id, userId: user.id, completedLessonIds: [], requiredLessonCount: required.length,
          completedLessonCount: 0, percentComplete: 0, version: 1, createdAt: now, updatedAt: now },
        audit: { eventId: `audit-demo-${user.id}`, occurredAt: now, requestId: "demo", actorUserId: "demo", expertId: DEMO_EXPERT_ID, action: "enrollment:create", targetType: "enrollment", targetId: `enr-${user.id}`, result: "allowed" }
      });
    }
  }

  return {
    enrollDemoUser,
    dashboard: new InMemoryDashboardRepository(dashboardData),
    courses: new InMemoryCourseRepository({ courses: [course], versions: [version] }),
    delivery,
    skills: { getSkill: async (_expertId: string, skillId: string) => (demoSkills[skillId] ? { latestName: demoSkills[skillId] } : null) } as never,
    users: { findById: async (id: string) => users.get(id) ?? null }
  };
}
