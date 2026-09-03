"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "./app-header";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  return (
    <>
      <AppHeader collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((current) => !current)} />
      <div className={cn("min-h-screen transition-[padding] duration-200", pathname !== "/login" && (sidebarCollapsed ? "lg:pl-20" : "lg:pl-64"))}>
        {children}
      </div>
    </>
  );
}
