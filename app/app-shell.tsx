"use client";

import { usePathname } from "next/navigation";
import { AppHeader } from "./app-header";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <AppHeader />
      <div className={cn("min-h-screen", pathname !== "/login" && "lg:pl-64")}>
        {children}
      </div>
    </>
  );
}
