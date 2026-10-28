"use client";

import { Building2, Facebook, Github, Linkedin, Mail, MapPin, Phone, Users } from "lucide-react";
import { useI18n } from "../../i18n/LocaleProvider";

const MAP_URL = "https://maps.app.goo.gl/xjX71UPp2ReE791j8";

export function AppFooter() {
  const { t } = useI18n();

  return (
    <footer className="border-t border-ink/10 bg-white/80" aria-label={t("footer.label")}>
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-28 pt-8 sm:gap-8 sm:px-6 sm:pb-8 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,0.8fr)] lg:px-8">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink">{t("footer.copyright")}</p>
          <p className="text-sm font-semibold uppercase tracking-wide text-ink">{t("footer.business")}</p>
          <div className="flex min-w-0 items-start gap-2 text-sm text-ink/70">
            <Building2 className="mt-0.5 shrink-0 text-lagoon" size={17} aria-hidden="true" />
            <span className="min-w-0 break-words">{t("footer.companyName")} - {t("footer.taxId")}: 0318561374</span>
          </div>

          <div className="flex flex-wrap gap-2 pt-3" aria-label={t("footer.socialMedia")}>
            <a className="grid size-10 place-items-center rounded-full border border-ink/15 bg-white text-ink/70 shadow-sm transition hover:border-lagoon/40 hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20" href="https://www.facebook.com/openmatrixskill/" target="_blank" rel="noreferrer" aria-label={t("footer.facebook")} title={t("footer.facebook")}>
              <Facebook size={18} aria-hidden="true" />
            </a>
            <a className="grid size-10 place-items-center rounded-full border border-ink/15 bg-white text-ink/70 shadow-sm transition hover:border-lagoon/40 hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20" href="https://www.facebook.com/groups/1334221278818506" target="_blank" rel="noreferrer" aria-label={t("footer.facebookGroup")} title={t("footer.facebookGroup")}>
              <Users size={18} aria-hidden="true" />
            </a>
            <a className="grid size-10 place-items-center rounded-full border border-ink/15 bg-white text-ink/70 shadow-sm transition hover:border-lagoon/40 hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20" href="https://x.com/OpenMatrixSkill" target="_blank" rel="noreferrer" aria-label="X" title="X">
              <span className="text-base font-bold leading-none" aria-hidden="true">X</span>
            </a>
            <a className="grid size-10 place-items-center rounded-full border border-ink/15 bg-white text-ink/70 shadow-sm transition hover:border-lagoon/40 hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20" href="https://www.linkedin.com/company/openmatrix-skill/" target="_blank" rel="noreferrer" aria-label="LinkedIn" title="LinkedIn">
              <Linkedin size={18} aria-hidden="true" />
            </a>
            <a className="grid size-10 place-items-center rounded-full border border-ink/15 bg-white text-ink/70 shadow-sm transition hover:border-lagoon/40 hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20" href="https://github.com/OpenMatrix-Skill/skills" target="_blank" rel="noreferrer" aria-label="GitHub" title="GitHub">
              <Github size={18} aria-hidden="true" />
            </a>
          </div>
        </div>

        <address className="grid min-w-0 content-start gap-3 text-sm not-italic text-ink/70">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">{t("footer.contact")}</h2>
          <a className="flex w-fit items-center gap-2 transition hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20" href="tel:+84974639191">
            <Phone className="shrink-0 text-lagoon" size={17} aria-hidden="true" />
            <span>0974639191</span>
          </a>
          <a className="flex w-fit items-center gap-2 break-all transition hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20" href="mailto:olym3labs@gmail.com">
            <Mail className="shrink-0 text-lagoon" size={17} aria-hidden="true" />
            <span>olym3labs@gmail.com</span>
          </a>
          <a
            className="flex items-start gap-2 transition hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20"
            href={MAP_URL}
            target="_blank"
            rel="noreferrer"
          >
            <MapPin className="mt-0.5 shrink-0 text-lagoon" size={17} aria-hidden="true" />
            <span className="min-w-0 break-words">Vincom Center Dong Khoi Building, 72 Le Thanh Ton Street, Sai Gon Ward, Ho Chi Minh City, Vietnam</span>
          </a>
        </address>

        <section className="space-y-3 md:col-span-2 lg:col-span-1" aria-labelledby="footer-legal-heading">
          <h2 id="footer-legal-heading" className="text-sm font-semibold uppercase tracking-wide text-ink">{t("footer.legal")}</h2>
          <ul className="grid gap-2 text-sm text-ink/70">
            <li>
              <a className="inline-flex min-h-10 items-center transition hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20" href="https://www.openmatrixskill.com/terms">{t("footer.terms")}</a>
            </li>
            <li>
              <a className="inline-flex min-h-10 items-center transition hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20" href="https://www.openmatrixskill.com/policies">{t("footer.policies")}</a>
            </li>
            <li>
              <a className="inline-flex min-h-10 items-center transition hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20" href="/dashboard/skilltutor/learners">{t("footer.expertApprovals")}</a>
            </li>
          </ul>
        </section>
      </div>
    </footer>
  );
}
