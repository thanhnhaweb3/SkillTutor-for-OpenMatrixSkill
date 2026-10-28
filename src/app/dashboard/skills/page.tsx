"use client";

import type { DashboardErrorBody, DashboardMe, Skill, SkillFramework } from "@openmatrix/dashboard";
import { ArrowLeft, BookOpen, Loader2, Plus, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useI18n } from "../../../i18n/LocaleProvider";
import { apiErrorText } from "../../../i18n/messages";

type PageData = { me: DashboardMe; frameworks: SkillFramework[]; skills: Skill[]; cursor?: string; mutationsEnabled: boolean };
type ApiError = { code: string; message: string; requestId: string };
type ImportPreview = { frameworkId: string; count: number; skills: Array<{ code: string; name: string }> };
type PageState =
  | { status: "loading" }
  | { status: "ready"; data: PageData }
  | { status: "error"; error: ApiError };

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json() as T | DashboardErrorBody;
  if (!response.ok) throw (body as DashboardErrorBody).error;
  return body as T;
}

export default function SkillsPage({ searchParams }: { searchParams: { expertId?: string } }) {
  const { t, locale } = useI18n();
  const l = (vi: string, en: string) => locale === "en" ? en : vi;
  const requestedExpertId = searchParams.expertId?.trim();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const [manifest, setManifest] = useState<unknown>();
  const [importPreview, setImportPreview] = useState<ImportPreview>();
  const [importKey, setImportKey] = useState<string>();
  const [importResult, setImportResult] = useState<string>();

  async function load(signal?: AbortSignal) {
    const meQuery = requestedExpertId ? `?${new URLSearchParams({ expertId: requestedExpertId })}` : "";
    const me = await responseBody<DashboardMe>(await fetch(`/api/dashboard/me${meQuery}`, { cache: "no-store", signal }));
    const query = new URLSearchParams({ expertId: me.activeExpert.id });
    const [frameworkResult, skillResult] = await Promise.all([
      fetch(`/api/dashboard/skill-frameworks?${query}`, { cache: "no-store", signal }),
      fetch(`/api/dashboard/skills?${query}`, { cache: "no-store", signal })
    ]);
    const frameworks = await responseBody<{ frameworks: SkillFramework[]; capabilities: { mutations: boolean } }>(frameworkResult);
    const skills = await responseBody<{ items: Skill[]; cursor?: string }>(skillResult);
    setState({ status: "ready", data: { me, frameworks: frameworks.frameworks, skills: skills.items, cursor: skills.cursor, mutationsEnabled: frameworks.capabilities.mutations } });
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((error: Partial<ApiError>) => {
      if (controller.signal.aborted) return;
      setState({ status: "error", error: {
        code: error.code ?? "INTERNAL_ERROR",
        message: error.message ?? t("skills.loadError"),
        requestId: error.requestId ?? "unknown"
      } });
    });
    return () => controller.abort();
  }, [requestedExpertId, t]);

  async function createSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "ready") return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSubmitting(true);
    setMutationError(undefined);
    try {
      await responseBody(await fetch("/api/dashboard/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expertId: state.data.me.activeExpert.id,
          frameworkId: String(form.get("frameworkId") ?? ""),
          code: String(form.get("code") ?? ""),
          name: String(form.get("name") ?? ""),
          description: String(form.get("description") ?? ""),
          outcomes: String(form.get("outcomes") ?? "").split("\n").map((item) => item.trim()).filter(Boolean),
          tags: String(form.get("tags") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
          ownerUserId: state.data.me.user.id
        })
      }));
      formElement.reset();
      await load();
    } catch (error) {
      const contract = error as Partial<ApiError>;
      setMutationError(`${contract.message ?? l("Không thể tạo skill.", "Could not create the skill.")}${contract.requestId ? ` · ${contract.requestId}` : ""}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.data.cursor) return;
    setSubmitting(true);
    try {
      const query = new URLSearchParams({ expertId: state.data.me.activeExpert.id, cursor: state.data.cursor });
      const page = await responseBody<{ items: Skill[]; cursor?: string }>(await fetch(`/api/dashboard/skills?${query}`, { cache: "no-store" }));
      setState({ status: "ready", data: { ...state.data, skills: [...state.data.skills, ...page.items], cursor: page.cursor } });
    } catch (error) {
      const contract = error as Partial<ApiError>;
      setMutationError(`${contract.message ?? l("Không thể tải trang kế tiếp.", "Could not load the next page.")}${contract.requestId ? ` · ${contract.requestId}` : ""}`);
    } finally { setSubmitting(false); }
  }

  async function selectManifest(file?: File) {
    setImportPreview(undefined); setImportKey(undefined); setImportResult(undefined); setMutationError(undefined); setManifest(undefined);
    if (!file) return;
    try { setManifest(JSON.parse(await file.text())); }
    catch { setMutationError(t("skills.invalidJson")); }
  }

  async function dryRunImport() {
    if (state.status !== "ready" || manifest === undefined) return;
    setSubmitting(true); setMutationError(undefined); setImportPreview(undefined); setImportResult(undefined);
    try {
      const result = await responseBody<{ preview: ImportPreview }>(await fetch("/api/dashboard/skills/import/dry-run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expertId: state.data.me.activeExpert.id, manifest })
      }));
      setImportPreview(result.preview);
      setImportKey(`ui:${crypto.randomUUID()}`);
    } catch (error) {
      const contract = error as Partial<ApiError>;
      setMutationError(`${contract.message ?? l("Dry-run thất bại.", "Dry run failed.")}${contract.requestId ? ` · ${contract.requestId}` : ""}`);
    } finally { setSubmitting(false); }
  }

  async function commitImport() {
    if (state.status !== "ready" || manifest === undefined || !importKey || !importPreview) return;
    if (!window.confirm(l(`Tạo ${importPreview.count} skill draft? Toàn bộ batch sẽ được commit trong một transaction.`, `Create ${importPreview.count} draft skills? The entire batch will be committed in one transaction.`))) return;
    setSubmitting(true); setMutationError(undefined);
    try {
      const result = await responseBody<{ receipt: { skillCodes: string[] }; replayed: boolean }>(await fetch("/api/dashboard/skills/import/commit", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expertId: state.data.me.activeExpert.id, manifest, idempotencyKey: importKey, confirm: true })
      }));
      setImportResult(`${result.replayed ? l("Replay an toàn", "Safe replay") : l("Đã import", "Imported")} · ${result.receipt.skillCodes.length} skill`);
      await load();
    } catch (error) {
      const contract = error as Partial<ApiError>;
      setMutationError(`${contract.message ?? l("Commit import thất bại.", "Import commit failed.")}${contract.requestId ? ` · ${contract.requestId}` : ""}`);
    } finally { setSubmitting(false); }
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-semibold text-lagoon">
        <ArrowLeft aria-hidden="true" /> {t("skills.backDashboard")}
      </Link>
      <header className="mt-4 rounded-xl border border-ink/10 bg-white/85 p-4 shadow-sm sm:p-6">
        <p className="text-sm font-semibold text-lagoon">{t("skills.phase")}</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">{t("skills.title")}</h1>
        <p className="mt-2 text-sm leading-6 text-ink/65">{t("skills.description")}</p>
      </header>

      {state.status === "loading" ? (
        <section className="mt-6 flex items-center gap-3 rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink/65 sm:p-6">
          <Loader2 className="animate-spin text-lagoon" aria-hidden="true" /> {t("skills.loading")}
        </section>
      ) : state.status === "error" ? (
        <section className="mt-6 rounded-xl border border-coral/20 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex gap-3"><ShieldAlert className="shrink-0 text-coral" aria-hidden="true" /><div>
            <h2 className="font-semibold text-ink">{state.error.code === "SKILLS_DISABLED" ? t("skills.disabled") : t("skills.loadError")}</h2>
            <p className="mt-2 text-sm text-ink/65">{state.error.code === "SKILLS_DISABLED" ? t("skills.disabledDescription") : apiErrorText(locale, state.error)}</p>
            <p className="wrap-anywhere mt-3 font-mono text-xs text-ink/45">{state.error.code} · {state.error.requestId}</p>
          </div></div>
        </section>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,.65fr)]">
          <section className="min-w-0 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex items-center gap-3"><BookOpen className="shrink-0 text-lagoon" aria-hidden="true" /><div className="min-w-0">
              <h2 className="font-semibold text-ink">{t("skills.catalog")}</h2>
              <p className="wrap-anywhere text-sm text-ink/55">{state.data.skills.length} {t("skills.inExpert")} {state.data.me.activeExpert.displayName}</p>
            </div></div>
            <div className="mt-5 space-y-3">
              {state.data.skills.length === 0 ? <p className="rounded-lg bg-ink/[.03] p-4 text-sm text-ink/55">{t("skills.empty")}</p> : state.data.skills.map((skill) => (
                <Link href={`/dashboard/skills/${encodeURIComponent(skill.id)}?${new URLSearchParams({ expertId: state.data.me.activeExpert.id })}`} key={skill.id} className="min-w-0 block rounded-lg border border-ink/10 p-4 transition hover:border-lagoon/40">
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4"><div className="min-w-0"><p className="wrap-anywhere text-xs font-semibold uppercase tracking-wide text-lagoon">{skill.code}</p><h3 className="wrap-anywhere mt-1 font-semibold text-ink">{skill.latestName}</h3></div><span className="shrink-0 rounded-full bg-ink/[.06] px-3 py-1 text-xs font-medium text-ink/60">{skill.latestStatus}</span></div>
                  <p className="wrap-anywhere mt-2 text-xs text-ink/45">{t("skills.version")} {skill.latestVersionNumber} · {t("skills.owner")} {skill.latestOwnerUserId}</p>
                </Link>
              ))}
            </div>
            {state.data.cursor ? <button disabled={submitting} onClick={() => void loadMore()} className="mt-4 rounded-md border border-lagoon px-4 py-2 text-sm font-semibold text-lagoon disabled:opacity-50">{t("skills.loadMore")}</button> : null}
          </section>

          {state.data.me.permissions.includes("skill:create") && state.data.mutationsEnabled ? (
            <div className="min-w-0 space-y-6"><form onSubmit={createSkill} className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
              <div className="flex items-center gap-2"><Plus className="text-lagoon" aria-hidden="true" /><h2 className="font-semibold text-ink">{t("skills.create")}</h2></div>
              <div className="mt-5 space-y-4">
                <Field label={t("skills.framework")}><select name="frameworkId" required className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm"><option value="">{t("skills.chooseFramework")}</option>{state.data.frameworks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                <Field label={t("skills.code")}><input name="code" required maxLength={32} className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm" /></Field>
                <Field label={t("skills.name")}><input name="name" required maxLength={120} className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm" /></Field>
                <Field label={t("skills.descriptionField")}><textarea name="description" required rows={4} className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm" /></Field>
                <Field label={t("skills.outcomesLines")}><textarea name="outcomes" required rows={4} className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm" /></Field>
                <Field label={t("skills.tagsComma")}><input name="tags" className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm" /></Field>
              </div>
              {mutationError ? <p className="wrap-anywhere mt-4 text-sm text-coral">{mutationError}</p> : null}
              <button disabled={submitting || state.data.frameworks.length === 0} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {submitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />} {submitting ? t("skills.creating") : t("skills.createDraft")}
              </button>
            </form>
            <section className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
              <h2 className="font-semibold text-ink">{t("skills.importTitle")}</h2>
              <p className="mt-2 text-sm leading-6 text-ink/55">{t("skills.importDescription")}</p>
              <label className="mt-4 block min-w-0"><span className="mb-1.5 block text-sm font-medium text-ink/70">{t("skills.manifest")}</span><input type="file" accept="application/json,.json" onChange={(event) => void selectManifest(event.target.files?.[0])} className="block max-w-full text-sm text-ink/60" /></label>
              <button type="button" disabled={submitting || manifest === undefined} onClick={() => void dryRunImport()} className="mt-4 rounded-md border border-lagoon px-4 py-2 text-sm font-semibold text-lagoon disabled:opacity-50">{t("skills.checkManifest")}</button>
              {importPreview ? <div className="mt-4 rounded-lg bg-lagoon/[.06] p-4"><p className="text-sm font-semibold text-lagoon">{t("skills.valid")} · {importPreview.count} skill</p><ul className="mt-2 space-y-1 text-sm text-ink/60">{importPreview.skills.map((item) => <li className="wrap-anywhere" key={item.code}>{item.code} · {item.name}</li>)}</ul><button type="button" disabled={submitting} onClick={() => void commitImport()} className="mt-4 rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t("skills.confirmImport")}</button></div> : null}
              {importResult ? <p className="wrap-anywhere mt-4 text-sm font-semibold text-lagoon">{importResult}</p> : null}
            </section></div>
          ) : <aside className="rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink/60 shadow-sm sm:p-6"><h2 className="font-semibold text-ink">{t("skills.readOnly")}</h2><p className="mt-2 leading-6">{t("skills.readOnlyDescription")}</p></aside>}
        </div>
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink/70">{label}</span>{children}</label>;
}
