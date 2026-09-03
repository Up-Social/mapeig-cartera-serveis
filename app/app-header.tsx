"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, Building2, CheckSquare, Database, FileCheck2, Layers3, LogOut, Menu, Route, TriangleAlert, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavigationCounts = { review: number; issues: number; approved: number };

const links = [
  { href: "/", label: "Registres", icon: Database },
  { href: "/batches", label: "Lots", icon: Layers3 },
  { href: "/review", label: "Revisió", icon: CheckSquare, count: "review" },
  { href: "/issues", label: "Incidències", icon: TriangleAlert, count: "issues" },
  { href: "/approved", label: "Aprovats", icon: FileCheck2, count: "approved" },
  { href: "/catalog", label: "Catàleg", icon: BookOpen },
  { href: "/entities", label: "Entitats", icon: Building2 },
  { href: "/process", label: "Procés", icon: Route },
] as const;

export function AppHeader() {
  const pathname = usePathname();
  const [counts, setCounts] = useState<NavigationCounts | null>(null);
  const refreshCounts = useCallback(async () => {
    try {
      const response = await fetch("/api/navigation-counts", { cache: "no-store" });
      if (response.ok) setCounts((await response.json()) as NavigationCounts);
    } catch {
      // La navegació continua disponible encara que el recompte no respongui.
    }
  }, []);

  useEffect(() => {
    if (pathname === "/login") return;
    const timer = window.setTimeout(() => void refreshCounts(), 0);
    return () => window.clearTimeout(timer);
  }, [pathname, refreshCounts]);

  useEffect(() => {
    window.addEventListener("navigation-counts:refresh", refreshCounts);
    return () => window.removeEventListener("navigation-counts:refresh", refreshCounts);
  }, [refreshCounts]);

  if (pathname === "/login") return null;
  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  const navigation = (mobile = false) => (
    <nav className="grid gap-1" aria-label={mobile ? "Navegació mòbil" : "Navegació principal"}>
      {links.map(({ href, label, icon: Icon, ...item }) => {
        const count = "count" in item && counts ? counts[item.count] : null;
        const content = <><Icon className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{label}</span>{count !== null && <NavigationBadge value={count} active={isActive(href)} />}</>;
        const className = cn("flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", isActive(href) && "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm hover:bg-sidebar-primary hover:text-sidebar-primary-foreground");
        return mobile ? <SheetClose key={href} nativeButton={false} render={<Link href={href} className={className} />}>{content}</SheetClose> : <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined} className={className}>{content}</Link>;
      })}
    </nav>
  );

  return <>
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <Brand />
      <div className="flex-1 overflow-y-auto px-3 py-5">{navigation()}</div>
      <Logout />
    </aside>
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
      <Brand compact />
      <Sheet>
        <SheetTrigger render={<Button variant="outline" size="icon-lg" aria-label="Obrir navegació" />}><Menu /></SheetTrigger>
        <SheetContent side="left" className="w-[min(88vw,320px)] bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="border-b border-sidebar-border p-5 text-left"><SheetTitle className="flex items-center gap-2"><Waypoints className="size-5" />Mapeig cartera de serveis</SheetTitle><SheetDescription>Navegació principal</SheetDescription></SheetHeader>
          <div className="p-3">{navigation(true)}</div>
          <Logout />
        </SheetContent>
      </Sheet>
    </header>
  </>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className={cn("flex min-w-0 items-center gap-3", compact ? "py-2" : "border-b border-sidebar-border px-5 py-5")}><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"><Waypoints className="size-4" aria-hidden="true" /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold tracking-tight">Mapeig cartera de serveis</span>{!compact && <span className="mt-0.5 block text-xs text-sidebar-foreground/55">UPSocial · Prova de concepte</span>}</span></Link>;
}

function NavigationBadge({ value, active }: { value: number; active: boolean }) {
  return <span className={cn("inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", active ? "bg-sidebar-primary-foreground/15 text-sidebar-primary-foreground" : "bg-sidebar-accent text-sidebar-accent-foreground")}>{value > 999 ? "999+" : value.toLocaleString("ca-ES")}</span>;
}

function Logout() {
  return <form action="/api/access/logout" method="post" className="mt-auto border-t border-sidebar-border p-3"><Button type="submit" variant="ghost" className="w-full justify-start gap-3 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><LogOut className="size-4" />Tancar sessió</Button></form>;
}
