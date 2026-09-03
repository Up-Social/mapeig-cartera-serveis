"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, Building2, CheckSquare, Database, FileCheck2, Layers3, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Route, TriangleAlert, Waypoints } from "lucide-react";
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

export function AppHeader({ collapsed, onToggleCollapsed }: { collapsed: boolean; onToggleCollapsed: () => void }) {
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
        const compact = collapsed && !mobile;
        const content = <><Icon className="size-4 shrink-0" aria-hidden="true" /><span className={cn("min-w-0 flex-1 truncate", compact && "sr-only")}>{label}</span>{count !== null && <NavigationBadge value={count} active={isActive(href)} compact={compact} />}</>;
        const className = cn("relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", compact && "justify-center px-2", isActive(href) && "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm hover:bg-sidebar-primary hover:text-sidebar-primary-foreground");
        return mobile ? <SheetClose key={href} nativeButton={false} render={<Link href={href} className={className} />}>{content}</SheetClose> : <Link key={href} href={href} title={compact ? label : undefined} aria-label={compact ? label : undefined} aria-current={isActive(href) ? "page" : undefined} className={className}>{content}</Link>;
      })}
    </nav>
  );

  return <>
    <aside className={cn("fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex", collapsed ? "w-20" : "w-64")}>
      <Brand collapsed={collapsed} />
      <div className="flex-1 overflow-y-auto px-3 py-5">{navigation()}</div>
      <div className="border-t border-sidebar-border p-3">
        <Button type="button" variant="ghost" onClick={onToggleCollapsed} className={cn("w-full gap-3 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", collapsed ? "justify-center px-2" : "justify-start")} aria-label={collapsed ? "Desplegar menú lateral" : "Plegar menú lateral"} title={collapsed ? "Desplegar menú lateral" : undefined}>
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && "Plegar menú"}
        </Button>
      </div>
      <Logout collapsed={collapsed} />
    </aside>
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
      <Brand mobile />
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

function Brand({ collapsed = false, mobile = false }: { collapsed?: boolean; mobile?: boolean }) {
  return <Link href="/" title={collapsed ? "Mapeig cartera de serveis" : undefined} aria-label={collapsed ? "Mapeig cartera de serveis" : undefined} className={cn("flex min-w-0 items-center gap-3", mobile ? "py-2" : "border-b border-sidebar-border px-5 py-5", collapsed && "justify-center px-3")}><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"><Waypoints className="size-4" aria-hidden="true" /></span>{!collapsed && <span className="min-w-0 text-sm font-semibold leading-5 tracking-tight"><span className="block">Mapeig cartera</span><span className="block">de serveis</span></span>}</Link>;
}

function NavigationBadge({ value, active, compact = false }: { value: number; active: boolean; compact?: boolean }) {
  return <span className={cn("inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", compact && "absolute -right-1 -top-1 min-w-5 px-1 text-[10px]", active ? "bg-sidebar-primary-foreground/15 text-sidebar-primary-foreground" : "bg-sidebar-accent text-sidebar-accent-foreground")}>{value > 999 ? "999+" : value.toLocaleString("ca-ES")}</span>;
}

function Logout({ collapsed = false }: { collapsed?: boolean }) {
  return <form action="/api/access/logout" method="post" className="border-t border-sidebar-border p-3"><Button type="submit" variant="ghost" title={collapsed ? "Tancar sessió" : undefined} aria-label={collapsed ? "Tancar sessió" : undefined} className={cn("w-full gap-3 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", collapsed ? "justify-center px-2" : "justify-start")}><LogOut className="size-4" />{!collapsed && "Tancar sessió"}</Button></form>;
}
