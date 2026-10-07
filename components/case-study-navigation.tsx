"use client";

import { useEffect, useState } from "react";

const sections = [
  { id: "resum", label: "Resum" },
  { id: "decisio", label: "Decisió" },
  { id: "resultat", label: "Resultat" },
  { id: "evidencies", label: "Evidències" },
  { id: "dades", label: "Dades" },
  { id: "historial", label: "Historial" },
] as const;

type SectionId = (typeof sections)[number]["id"];

export function CaseStudyNavigation() {
  const [active, setActive] = useState<SectionId>("resum");

  useEffect(() => {
    const updateActiveSection = () => {
      const marker = 180;
      let current: SectionId = "resum";
      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= marker) current = section.id;
      }
      setActive(current);
    };

    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("hashchange", updateActiveSection);
    return () => {
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("hashchange", updateActiveSection);
    };
  }, []);

  return <nav aria-label="Apartats de l'estudi" className="surface sticky top-0 z-20 p-3 shadow-sm">
    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Estudi del cas · 6 apartats</p>
    <div className="flex gap-2 overflow-x-auto pb-1">
      {sections.map((section, index) => <a
        key={section.id}
        href={`#${section.id}`}
        aria-current={active === section.id ? "location" : undefined}
        onClick={() => setActive(section.id)}
        className={`flex min-h-11 min-w-max flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${active === section.id ? "border-neutral-900 bg-neutral-900 text-white" : "border-border bg-background hover:bg-muted"}`}
      >
        <span aria-hidden="true" className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${active === section.id ? "bg-white text-neutral-900" : "bg-muted text-muted-foreground"}`}>{index + 1}</span>
        {section.label}
      </a>)}
    </div>
  </nav>;
}
