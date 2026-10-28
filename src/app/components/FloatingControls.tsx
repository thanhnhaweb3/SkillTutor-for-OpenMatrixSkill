"use client";

import { ArrowUp, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/LocaleProvider";
import { SkillTutorChat } from "./SkillTutorChat";

type Theme = "light" | "dark";

export function FloatingControls() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>("light");
  const [showGoToTop, setShowGoToTop] = useState(false);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");

    const updateGoToTop = () => setShowGoToTop(window.scrollY > 300);
    updateGoToTop();
    window.addEventListener("scroll", updateGoToTop, { passive: true });
    return () => window.removeEventListener("scroll", updateGoToTop);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    localStorage.setItem("oms-theme", nextTheme);
    setTheme(nextTheme);
  }

  const themeLabel = theme === "dark" ? t("theme.useLight") : t("theme.useDark");

  return (
    <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-40 flex flex-col items-end gap-2 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:right-[calc(1.5rem+env(safe-area-inset-right))]">
      <button
        className="grid size-11 place-items-center rounded-full border border-ink/15 bg-white text-ink shadow-lg transition hover:-translate-y-0.5 hover:border-lagoon/50 hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/30 focus:ring-offset-2 dark:ring-offset-slate-900"
        type="button"
        onClick={toggleTheme}
        aria-label={themeLabel}
        title={themeLabel}
      >
        {theme === "dark" ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
      </button>

      {showGoToTop ? (
        <button
          className="grid size-11 place-items-center rounded-full bg-lagoon text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-lagoon/90 focus:outline-none focus:ring-2 focus:ring-lagoon/30 focus:ring-offset-2 dark:ring-offset-slate-900"
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label={t("theme.goToTop")}
          title={t("theme.goToTop")}
        >
          <ArrowUp size={19} aria-hidden="true" />
        </button>
      ) : null}

      <SkillTutorChat />
    </div>
  );
}
