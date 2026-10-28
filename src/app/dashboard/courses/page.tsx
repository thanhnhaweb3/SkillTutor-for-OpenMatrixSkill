"use client";

import type { Course, DashboardErrorBody, DashboardMe } from "@openmatrix/dashboard";
import { ArrowLeft, BookOpenCheck, Loader2, Plus, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useI18n } from "../../../i18n/LocaleProvider";

type ApiError = { code: string; message: string; requestId: string };
type State = { status: "loading" } | { status: "error"; error: ApiError } |
  { status: "ready"; me: DashboardMe; courses: Course[]; cursor?: string; mutations: boolean };
async function json<T>(response: Response): Promise<T> { const body = await response.json(); if (!response.ok) throw body.error; return body as T; }
const mutationHeaders = () => ({ "content-type": "application/json", "idempotency-key": `course-ui:${crypto.randomUUID()}` });

export default function CoursesPage({ searchParams }: { searchParams: { expertId?: string } }) {
  const { locale } = useI18n(), l = (vi: string, en: string) => locale === "en" ? en : vi;
  const [state, setState] = useState<State>({ status: "loading" }), [busy, setBusy] = useState(false), [mutationError, setMutationError] = useState<string>();
  async function load(signal?: AbortSignal) { const meQuery = searchParams.expertId ? `?${new URLSearchParams({ expertId: searchParams.expertId })}` : "";
    const me = await json<DashboardMe>(await fetch(`/api/dashboard/me${meQuery}`, { cache: "no-store", signal }));
    const result = await json<{ items: Course[]; capabilities: { mutations: boolean } }>(await fetch(`/api/dashboard/courses?${new URLSearchParams({ expertId: me.activeExpert.id })}`, { cache: "no-store", signal }));
    const mutations = result.capabilities.mutations && me.permissions.includes("course:create"); setState({ status: "ready", me, courses: result.items, mutations }); }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch((error) => !controller.signal.aborted && setState({ status: "error", error })); return () => controller.abort(); }, [searchParams.expertId]);
  async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (state.status !== "ready") return; const formElement = event.currentTarget; const form = new FormData(formElement); setBusy(true); setMutationError(undefined);
    try { const id = crypto.randomUUID(); await json(await fetch("/api/dashboard/courses", { method: "POST", headers: mutationHeaders(), body: JSON.stringify({ expertId: state.me.activeExpert.id,
      code: form.get("code"), title: form.get("title"), description: form.get("description"), ownerUserId: state.me.user.id,
      modules: [{ id: `module_${id}`, title: l("Mô-đun đầu tiên", "First module"), position: 1, lessons: [{ id: `lesson_${id}`, title: l("Bài học đầu tiên", "First lesson"),
        summary: l("Chỉnh sửa nội dung bài học trong course editor.", "Edit this lesson in the course editor."), position: 1, estimatedMinutes: 15, outcomes: [] }] }] }) }));
      formElement.reset(); await load(); } catch (error) { const e = error as DashboardErrorBody["error"]; setMutationError(`${e.message} · ${e.requestId}`); } finally { setBusy(false); } }
  return <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-semibold text-lagoon"><ArrowLeft aria-hidden /> {l("Bảng điều khiển", "Dashboard")}</Link>
    <header className="mt-4 rounded-xl border border-ink/10 bg-white/85 p-4 shadow-sm sm:p-6"><p className="text-sm font-semibold text-lagoon">OMS Dashboard · Phase 3</p><h1 className="mt-1 text-3xl font-semibold text-ink">{l("Không gian Courses", "Course workspace")}</h1><p className="mt-2 text-sm text-ink/65">{l("Soạn thảo, review và xuất bản chương trình học có phiên bản.", "Author, review, and publish versioned learning programs.")}</p></header>
    {state.status === "loading" ? <section className="mt-6 flex items-center gap-3 rounded-xl border border-ink/10 bg-white p-4 sm:p-6"><Loader2 className="shrink-0 animate-spin text-lagoon" aria-hidden />{l("Đang tải courses…", "Loading courses…")}</section>
      : state.status === "error" ? <section className="mt-6 flex gap-3 rounded-xl border border-coral/20 bg-white p-4 sm:p-6"><ShieldAlert className="shrink-0 text-coral" aria-hidden /><div className="min-w-0"><h2 className="font-semibold">{state.error.code === "COURSES_DISABLED" ? l("Courses chưa được mở", "Courses are not enabled") : l("Không thể tải courses", "Could not load courses")}</h2><p className="wrap-anywhere mt-2 text-sm text-ink/60">{state.error.message} · {state.error.requestId}</p></div></section>
        : <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,.7fr)]"><section className="min-w-0 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6"><div className="flex items-center gap-3"><BookOpenCheck className="shrink-0 text-lagoon" aria-hidden /><div className="min-w-0"><h2 className="font-semibold">{l("Danh mục course", "Course catalog")}</h2><p className="wrap-anywhere text-sm text-ink/55">{state.courses.length} · {state.me.activeExpert.displayName}</p></div></div>
          <div className="mt-5 space-y-3">{state.courses.length ? state.courses.map((course) => <Link key={course.id} href={`/dashboard/courses/${course.id}?${new URLSearchParams({ expertId: state.me.activeExpert.id })}`} className="min-w-0 block rounded-lg border border-ink/10 p-4 transition hover:border-lagoon/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-lagoon"><div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4"><div className="min-w-0"><p className="wrap-anywhere text-xs font-semibold uppercase tracking-wide text-lagoon">{course.code}</p><h3 className="wrap-anywhere mt-1 font-semibold">{course.latestTitle}</h3><p className="wrap-anywhere mt-2 text-xs text-ink/50">{l("Phiên bản", "Version")} {course.latestVersionNumber} · {course.latestOwnerUserId}</p></div><Status value={course.latestStatus} /></div></Link>) : <p className="rounded-lg bg-ink/[.03] p-4 text-sm text-ink/55">{l("Chưa có course trong Expert này.", "No courses in this Expert yet.")}</p>}</div>
        </section>{state.mutations ? <aside className="min-w-0 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6"><div className="flex items-center gap-2"><Plus className="shrink-0 text-lagoon" aria-hidden /><h2 className="font-semibold">{l("Tạo course", "Create course")}</h2></div><form onSubmit={create} className="mt-4 space-y-4"><Field label={l("Mã course", "Course code")}><input name="code" required maxLength={32} className="control" /></Field><Field label={l("Tên course", "Course title")}><input name="title" required maxLength={160} className="control" /></Field><Field label={l("Mô tả", "Description")}><textarea name="description" required rows={4} className="control" /></Field>{mutationError ? <p role="alert" className="wrap-anywhere text-sm text-coral">{mutationError}</p> : null}<button disabled={busy} className="w-full rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? l("Đang tạo…", "Creating…") : l("Tạo draft", "Create draft")}</button></form></aside>
          : <aside className="rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink/60 sm:p-6"><h2 className="font-semibold text-ink">{l("Chế độ chỉ đọc", "Read-only mode")}</h2><p className="mt-2">{l("Bạn không có quyền tạo course trong Expert này.", "You cannot create courses in this Expert.")}</p></aside>}</div>}
  </main>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink/70">{label}</span>{children}</label>; }
function Status({ value }: { value: string }) { return <span className="h-fit shrink-0 rounded-full bg-ink/[.06] px-3 py-1 text-xs font-semibold text-ink/60">{value.replace("_", " ")}</span>; }
