"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "./app-header";
import {
  REFERENCE_SECTIONS,
  RESULT_SECTIONS,
  SectionNavigation,
} from "@/components/section-navigation";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const resultSection = RESULT_SECTIONS.some(({ href }) =>
    pathname.startsWith(href),
  );
  const referenceSection = REFERENCE_SECTIONS.some(({ href }) =>
    pathname.startsWith(href),
  );
  return (
    <>
      <AppHeader collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((current) => !current)} />
      <div className={cn("min-h-screen transition-[padding] duration-200", pathname !== "/login" && (sidebarCollapsed ? "lg:pl-20" : "lg:pl-64"))}>
        {(resultSection || referenceSection) && (
          <div className="mx-auto max-w-6xl px-5 pt-5">
            <SectionNavigation
              label={resultSection ? "Apartats de resultats" : "Apartats de referència"}
              items={resultSection ? RESULT_SECTIONS : REFERENCE_SECTIONS}
            />
          </div>
        )}
        {children}
      </div>
    </>
  );
}
