"use client";

import type { DashboardMe, Skill, SkillVersion } from "@openmatrix/dashboard";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useI18n } from "../../../../i18n/LocaleProvider";
import { apiErrorText } from "../../../../i18n/messages";

type ApiError = { code: string; message: string; requestId: string };
type Aggregate = { skill: Skill; version: SkillVersion; capabilities?: { mutations: boolean } };

async function read<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error: ApiError };
  if (!response.ok) throw (body as { error: ApiError }).error;
  return body as T;
}

export default function SkillDetailPage({ params, searchParams }: { params: { skillId: string }; searchParams: { expertId?: string } }) {
  const { locale, t } = useI18n();
  const requestedExpertId = searchParams.expertId?.trim();
  const [me, setMe] = useState<DashboardMe>();
  const [aggregate, setAggregate] = useState<Aggregate>();
  const [history, setHistory] = useState<SkillVersion[]>([]);
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  async function load() {
    const meQuery = requestedExpertId ? `?${new URLSearchParams({ expertId: requestedExpertId })}` : "";
    const currentMe = await read<DashboardMe>(await fetch(`/api/dashboard/me${meQuery}`, { cache: "no-store" }));
    const query = new URLSearchParams({ expertId: currentMe.activeExpert.id });
    const current = await read<Aggregate>(await fetch(`/api/dashboard/skills/${encodeURIComponent(params.skillId)}?${query}`, { cache: "no-store" }));
    const versions = await Promise.all(Array.from({ length: current.skill.latestVersionNumber }, async (_, index) =>
      read<Aggregate>(await fetch(`/api/dashboard/skills/${encodeURIComponent(params.skillId)}?${query}&version=${index + 1}`, { cache: "no-store" }))
    ));
    setMe(currentMe); setAggregate(current); setHistory(versions.map((item) => item.version).reverse()); setError(undefined);
  }

  useEffect(() => { void load().catch((cause: ApiError) => setError(cause)); }, [params.skillId, requestedExpertId]);

  async function mutate(path: string, body: Record<string, unknown>, method = "POST") {
    if (!me) return;
    setBusy(true); setError(undefined);
    try {
      await read(await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ expertId: me.activeExpert.id, ...body }) }));
      await load();
    } catch (cause) { setError(cause as ApiError); }
    finally { setBusy(false); }
  }

  function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!aggregate) return;
    const form = new FormData(event.currentTarget);
    void mutate(`/api/dashboard/skills/${encodeURIComponent(params.skillId)}/versions/${aggregate.version.versionNumber}`, {
      expectedVersion: aggregate.version.version,
      name: String(form.get("name") ?? ""), description: String(form.get("description") ?? ""),
      outcomes: String(form.get("outcomes") ?? "").split("\n").map((x) => x.trim()).filter(Boolean),
      tags: String(form.get("tags") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      ownerUserId: aggregate.version.ownerUserId
    }, "PATCH");
  }

  if (error && !aggregate) return <Message title={t("skills.detailOpenError")} detail={`${apiErrorText(locale, error)} · ${error.requestId}`} />;
  if (!me || !aggregate) return <Message title={t("skills.detailLoading")} spinner />;
  const { skill, version } = aggregate;
  const base = `/api/dashboard/skills/${encodeURIComponent(skill.id)}/versions/${version.versionNumber}`;
  const mutationsEnabled = aggregate.capabilities?.mutations === true;
  const canUpdate = mutationsEnabled && me.permissions.includes("skill:update") && version.status === "draft";
  const canReview = mutationsEnabled && me.permissions.includes("skill:review") && version.status === "in_review";
  const canPublish = mutationsEnabled && me.permissions.includes("skill:publish") && version.status === "in_review" && version.createdBy !== me.user.id;

  return <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
    <Link href={`/dashboard/skills?${new URLSearchParams({ expertId: me.activeExpert.id })}`} className="inline-flex items-center gap-2 text-sm font-semibold text-lagoon"><ArrowLeft /> {t("skills.title")}</Link>
    <header className="mt-4 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4"><div className="min-w-0"><p className="wrap-anywhere text-sm font-semibold text-lagoon">{skill.code} · {t("skills.version")} {version.versionNumber}</p><h1 className="wrap-anywhere mt-1 text-3xl font-semibold text-ink">{version.name}</h1></div><span className="shrink-0 rounded-full bg-ink/[.06] px-3 py-1 text-xs font-semibold text-ink/60">{version.status}</span></div>
      <p className="wrap-anywhere mt-3 text-sm leading-6 text-ink/65">{version.description}</p>
    </header>
    {error ? <p className="wrap-anywhere mt-4 rounded-lg border border-coral/20 bg-white p-4 text-sm text-coral">{apiErrorText(locale, error)} · {error.requestId}</p> : null}
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="min-w-0 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="font-semibold text-ink">{canUpdate ? t("skills.editDraft") : t("skills.content")}</h2>
        {canUpdate ? <form onSubmit={update} className="mt-4 space-y-4">
          <Input label={t("skills.name")}><input name="name" required defaultValue={version.name} className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm" /></Input>
          <Input label={t("skills.descriptionField")}><textarea name="description" required rows={5} defaultValue={version.description} className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm" /></Input>
          <Input label={t("skills.outcomesLines")}><textarea name="outcomes" required rows={5} defaultValue={version.outcomes.join("\n")} className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm" /></Input>
          <Input label={t("skills.tagsComma")}><input name="tags" defaultValue={version.tags.join(", ")} className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm" /></Input>
          <button disabled={busy} className="rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t("skills.save")}</button>
        </form> : <div className="mt-4"><h3 className="text-sm font-semibold text-ink/70">{t("skills.outcomes")}</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/60">{version.outcomes.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
          {canUpdate ? <button disabled={busy} onClick={() => void mutate(`${base}/submit-review`, { expectedVersion: version.version })} className="min-h-11 rounded-md border border-lagoon px-4 py-2 text-sm font-semibold text-lagoon">{t("skills.submitReview")}</button> : null}
          {canReview ? <button disabled={busy} onClick={() => { const note = window.prompt(t("skills.changePrompt")); if (note) void mutate(`${base}/request-changes`, { expectedVersion: version.version, note }); }} className="min-h-11 rounded-md border border-coral/40 px-4 py-2 text-sm font-semibold text-coral">{t("skills.requestChanges")}</button> : null}
          {canPublish ? <button disabled={busy} onClick={() => void mutate(`${base}/publish`, { expectedVersion: version.version })} className="min-h-11 rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white">{t("skills.publish")}</button> : null}
          {mutationsEnabled && version.status === "published" && me.permissions.includes("skill:update") ? <button disabled={busy} onClick={() => void mutate(`/api/dashboard/skills/${encodeURIComponent(skill.id)}/versions`, {})} className="min-h-11 rounded-md border border-lagoon px-4 py-2 text-sm font-semibold text-lagoon">{t("skills.nextVersion")}</button> : null}
        </div>
      </section>
      <aside className="min-w-0 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6"><h2 className="font-semibold text-ink">{t("skills.history")}</h2><ol className="mt-4 space-y-3">{history.map((item) => <li key={item.id} className="rounded-lg border border-ink/10 p-3"><p className="text-sm font-semibold">{t("skills.version")} {item.versionNumber}</p><p className="wrap-anywhere mt-1 text-xs text-ink/50">{item.status} · {new Date(item.updatedAt).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US")}</p></li>)}</ol></aside>
    </div>
  </main>;
}

function Input({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink/70">{label}</span>{children}</label>; }
function Message({ title, detail, spinner }: { title: string; detail?: string; spinner?: boolean }) { return <main className="mx-auto max-w-3xl px-4 py-10"><section className="flex items-center gap-3 rounded-xl border border-ink/10 bg-white p-4 sm:p-6">{spinner ? <Loader2 className="shrink-0 animate-spin text-lagoon" /> : null}<div className="min-w-0"><h1 className="font-semibold text-ink">{title}</h1>{detail ? <p className="wrap-anywhere mt-2 text-sm text-ink/60">{detail}</p> : null}</div></section></main>; }
