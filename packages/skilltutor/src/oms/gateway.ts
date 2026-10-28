import { randomUUID } from "node:crypto";
import {
  DeliveryService,
  resolveDashboardMe,
  type CourseRepository,
  type CourseVersion,
  type DashboardRepository,
  type DeliveryRepository,
  type ExpertContext,
  type SkillRepository
} from "@openmatrix/dashboard";
import type { AcUser } from "@openmatrix/oms-ac-login";
import { admitLearner, type AdmitOutcome } from "./admission";
import { addTeamMember, isStaff, removeTeamMember, type TeamAddOutcome, type TeamRemoveOutcome, type TeamRole } from "./team";

export interface LearnerProfileView { id: string; name: string; email?: string; locale: "vi" | "en" }

export interface LessonView {
  id: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
  moduleTitle: string;
  index: number; // 1-based position across the course
  total: number;
  outcomes: { statement: string; skillId: string; targetProficiencyCode: string }[];
}

export interface EnrollmentView {
  expertId: string;
  expertName: string;
  cohortId: string;
  cohortName: string;
  courseId: string;
  courseTitle: string;
  courseVersionId: string;
  courseVersionNumber: number;
  status: "active" | "revoked" | "completed";
  completedLessonIds: string[];
  completedLessonCount: number;
  requiredLessonCount: number;
  percentComplete: number;
  courseCompletedAt?: string;
}

export interface CompleteLessonResult {
  recorded: boolean;
  replayed?: boolean;
  percentComplete?: number;
  courseCompleted?: boolean;
  reason?: "PROGRESS_DISABLED" | "NOT_ENROLLED" | "ERROR";
}

/** What SkillTutor needs from OpenMatrix Skill. OMS stays the system of record. */
export interface LearningGateway {
  getUser(userId: string): Promise<LearnerProfileView | null>;
  listEnrollments(userId: string): Promise<EnrollmentView[]>;
  getCourseVersion(expertId: string, courseId: string, versionNumber: number): Promise<CourseVersion | null>;
  getLessons(expertId: string, courseId: string, versionNumber: number): Promise<LessonView[]>;
  completeLesson(input: { userId: string; userName: string; expertId: string; cohortId: string; lessonId: string }): Promise<CompleteLessonResult>;
  skillNames(expertId: string, skillIds: string[]): Promise<Record<string, string>>;
  /** OMS Expert context of a web user (roles/permissions) – used to authorize the operator dashboard. */
  resolveContext(user: { id: string; displayName: string }, expertId?: string): Promise<ExpertContext | null>;
  isMember(expertId: string, userId: string): Promise<boolean>;
  /** Learner admin (Expert staff): cohorts, roster, account lookup and admission. */
  findUserByEmail(email: string): Promise<LearnerProfileView | null>;
  listCohorts(expertId: string): Promise<CohortView[]>;
  listRoster(expertId: string, cohortId: string): Promise<RosterEntry[]>;
  admit(actor: ExpertContext, cohortId: string, userId: string): Promise<{ outcome: AdmitOutcome; membershipCreated: boolean }>;
  /** Expert team (staff roles, e.g. hackathon judges as reviewers). */
  listTeam(expertId: string): Promise<TeamMemberView[]>;
  addTeamMember(actor: ExpertContext, userId: string, role: TeamRole): Promise<TeamAddOutcome>;
  removeTeamMember(actor: ExpertContext, userId: string): Promise<TeamRemoveOutcome>;
}

export interface CohortView { id: string; expertId: string; expertName: string; name: string; status: string; startDate: string; courseId: string; courseCode?: string; courseTitle: string; courseVersionNumber: number; lessonCount: number }
export interface TeamMemberView { userId: string; name: string; email?: string; roles: string[] }
export interface RosterEntry { userId: string; name: string; email?: string; enrolledAt: string; status: string; percentComplete: number; completedLessonCount: number; requiredLessonCount: number; courseCompletedAt?: string }

export function lessonsOf(version: CourseVersion): LessonView[] {
  const modules = [...version.modules].sort((a, b) => a.position - b.position);
  const flat = modules.flatMap((m) => [...m.lessons].sort((a, b) => a.position - b.position).map((l) => ({ l, moduleTitle: m.title })));
  return flat.map(({ l, moduleTitle }, i) => ({
    id: l.id, title: l.title, summary: l.summary, estimatedMinutes: l.estimatedMinutes, moduleTitle, index: i + 1, total: flat.length,
    outcomes: l.outcomes.map((o) => ({ statement: o.statement, skillId: o.skillId, targetProficiencyCode: o.targetProficiencyCode }))
  }));
}

export interface OmsGatewayDeps {
  users: { findById(id: string): Promise<AcUser | null>; findByEmail?(email: string): Promise<AcUser | null> };
  dashboard: DashboardRepository;
  courses: CourseRepository;
  delivery: DeliveryRepository;
  skills?: Pick<SkillRepository, "getSkill">;
  /** Language for profiles without one (SKILLTUTOR_DEFAULT_LOCALE). */
  defaultLocale?: "vi" | "en";
  /** Mirrors the OMS progress rollout flag (DASHBOARD_PROGRESS_ENABLED + canary allowlist). */
  progressEnabled: (expertId: string) => boolean;
  now?: () => Date;
}

/** LearningGateway on top of the real OMS packages: memberships, cohorts, enrollments and DeliveryService. */
export class OmsLearningGateway implements LearningGateway {
  constructor(private readonly deps: OmsGatewayDeps) {}

  async getUser(userId: string) {
    const u = await this.deps.users.findById(userId);
    return u ? { id: u.id, name: u.name, email: u.email, locale: this.localeOf(u.locale) } : null;
  }

  private localeOf(locale: string | undefined): "vi" | "en" {
    return locale === "en" || locale === "vi" ? locale : this.deps.defaultLocale ?? "vi";
  }

  async listEnrollments(userId: string) {
    const enrollments = (await this.deps.delivery.listEnrollmentsByUser?.(userId)) ?? [];
    const views: EnrollmentView[] = [];
    for (const e of enrollments) {
      if (e.status === "revoked") continue;
      const [cohort, course, progress, expert] = await Promise.all([
        this.deps.delivery.getCohort(e.expertId, e.cohortId),
        this.deps.courses.getCourse(e.expertId, e.courseId),
        this.deps.delivery.getSelfProgress(e.expertId, e.cohortId, userId),
        this.deps.dashboard.getExpert(e.expertId)
      ]);
      if (!cohort || !course || !progress || !expert || expert.status !== "active") continue;
      views.push({
        expertId: e.expertId, expertName: expert.displayName, cohortId: cohort.id, cohortName: cohort.name, courseId: course.id,
        courseTitle: course.latestTitle, courseVersionId: cohort.courseVersionId, courseVersionNumber: cohort.courseVersionNumber, status: e.status,
        completedLessonIds: progress.completedLessonIds, completedLessonCount: progress.completedLessonCount,
        requiredLessonCount: progress.requiredLessonCount, percentComplete: progress.percentComplete, courseCompletedAt: progress.courseCompletedAt
      });
    }
    return views.sort((a, b) => Number(!!a.courseCompletedAt) - Number(!!b.courseCompletedAt) || a.courseTitle.localeCompare(b.courseTitle));
  }

  getCourseVersion(expertId: string, courseId: string, versionNumber: number) {
    return this.deps.courses.getCourseVersion(expertId, courseId, versionNumber);
  }

  async getLessons(expertId: string, courseId: string, versionNumber: number) {
    const version = await this.getCourseVersion(expertId, courseId, versionNumber);
    return version && version.status === "published" ? lessonsOf(version) : [];
  }

  async completeLesson(input: { userId: string; userName: string; expertId: string; cohortId: string; lessonId: string }): Promise<CompleteLessonResult> {
    if (!this.deps.progressEnabled(input.expertId)) return { recorded: false, reason: "PROGRESS_DISABLED" };
    try {
      const { context } = await resolveDashboardMe({ user: { id: input.userId, displayName: input.userName }, requestedExpertId: input.expertId, repository: this.deps.dashboard });
      const service = new DeliveryService(this.deps.delivery, this.deps.courses, this.deps.dashboard, this.deps.now);
      const r = await service.completeLesson({ context, cohortId: input.cohortId, lessonId: input.lessonId, requestId: `skilltutor_${randomUUID()}` });
      return { recorded: true, replayed: r.replayed, percentComplete: r.progress.percentComplete, courseCompleted: !!r.progress.courseCompletedAt };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "OUTSIDE_EXPERT" || code === "NOT_MEMBER" || code === "MEMBERSHIP_INACTIVE") return { recorded: false, reason: "NOT_ENROLLED" };
      console.error("skilltutor_complete_lesson_failed", { expertId: input.expertId, cohortId: input.cohortId, error });
      return { recorded: false, reason: "ERROR" };
    }
  }

  async skillNames(expertId: string, skillIds: string[]) {
    const out: Record<string, string> = {};
    for (const id of new Set(skillIds)) {
      const skill = await this.deps.skills?.getSkill(expertId, id).catch(() => null);
      out[id] = skill?.latestName ?? id;
    }
    return out;
  }

  async resolveContext(user: { id: string; displayName: string }, expertId?: string) {
    try {
      return (await resolveDashboardMe({ user, requestedExpertId: expertId, repository: this.deps.dashboard })).context;
    } catch {
      return null;
    }
  }

  async isMember(expertId: string, userId: string) {
    const m = await this.deps.dashboard.getMembership(expertId, userId);
    return m?.status === "active";
  }

  async findUserByEmail(email: string) {
    const u = await this.deps.users.findByEmail?.(email.trim().toLowerCase());
    return u ? { id: u.id, name: u.name, email: u.email, locale: this.localeOf(u.locale) } : null;
  }

  async listCohorts(expertId: string) {
    const out: CohortView[] = [];
    const expertName = (await this.deps.dashboard.getExpert(expertId))?.displayName ?? expertId;
    let cursor: string | undefined;
    do {
      const page = await this.deps.delivery.listCohorts({ expertId, limit: 100, cursor });
      for (const c of page.items) {
        const [version, course] = await Promise.all([
          this.deps.courses.getCourseVersion(expertId, c.courseId, c.courseVersionNumber), this.deps.courses.getCourse(expertId, c.courseId)
        ]);
        out.push({ id: c.id, expertId, expertName, name: c.name, status: c.status, startDate: c.startDate, courseId: c.courseId, courseCode: course?.code, courseTitle: version?.title ?? c.courseId,
          courseVersionNumber: c.courseVersionNumber, lessonCount: version ? lessonsOf(version).length : 0 });
      }
      cursor = page.cursor;
    } while (cursor);
    return out.sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  async listRoster(expertId: string, cohortId: string) {
    const enrollments = (await this.deps.delivery.listEnrollmentsByCohort?.(expertId, cohortId)) ?? [];
    const rows: RosterEntry[] = [];
    for (const e of enrollments) {
      const [user, progress] = await Promise.all([this.deps.users.findById(e.userId), this.deps.delivery.getSelfProgress(expertId, cohortId, e.userId)]);
      rows.push({ userId: e.userId, name: user?.name ?? e.userId, email: user?.email, enrolledAt: e.enrolledAt, status: e.status,
        percentComplete: progress?.percentComplete ?? 0, completedLessonCount: progress?.completedLessonCount ?? 0,
        requiredLessonCount: progress?.requiredLessonCount ?? 0, courseCompletedAt: progress?.courseCompletedAt });
    }
    return rows.sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt));
  }

  admit(actor: ExpertContext, cohortId: string, userId: string) {
    return admitLearner(this.deps, actor, { cohortId, userId });
  }

  async listTeam(expertId: string) {
    const memberships = ((await this.deps.dashboard.listMembershipsByExpert?.(expertId)) ?? []).filter(isStaff);
    const rows = await Promise.all(memberships.map(async (m) => {
      const user = await this.deps.users.findById(m.userId);
      return { userId: m.userId, name: user?.name ?? m.userId, email: user?.email, roles: m.roles.filter((r) => r !== "learner") };
    }));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  addTeamMember(actor: ExpertContext, userId: string, role: TeamRole) {
    return addTeamMember(this.deps.dashboard, actor, userId, role);
  }

  removeTeamMember(actor: ExpertContext, userId: string) {
    return removeTeamMember(this.deps.dashboard, actor, userId);
  }
}
