"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Building2,
  FileCheck2,
  CheckSquare,
  Database,
  Layers3,
  Menu,
  Route,
  Waypoints,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Registres", icon: Database },
  { href: "/batches", label: "Lots", icon: Layers3 },
  { href: "/review", label: "Revisió", icon: CheckSquare },
  { href: "/approved", label: "Aprovats", icon: FileCheck2 },
  { href: "/catalog", label: "Catàleg", icon: BookOpen },
  { href: "/entities", label: "Entitats", icon: Building2 },
  { href: "/process", label: "Procés", icon: Route },
];

export function AppHeader() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
            <Waypoints className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight">
              Mapeig cartera de serveis
            </span>
            <span className="hidden text-xs text-muted-foreground sm:block">
              UPSocial · Prova de concepte
            </span>
          </span>
        </Link>
        <nav
          aria-label="Navegació principal"
          className="hidden items-center gap-0.5 lg:flex"
        >
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                isActive(href) && "bg-muted text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <Sheet>
          <SheetTrigger
            render={
              <Button
                variant="outline"
                size="icon-lg"
                className="lg:hidden"
                aria-label="Obrir navegació"
              />
            }
          >
            <Menu />
          </SheetTrigger>
          <SheetContent side="right" className="w-[min(88vw,340px)]">
            <SheetHeader className="border-b p-5">
              <SheetTitle className="flex items-center gap-2">
                <Waypoints className="size-5" />
                Mapeig cartera de serveis
              </SheetTitle>
              <SheetDescription>Navegació principal</SheetDescription>
            </SheetHeader>
            <nav className="grid gap-1 p-3" aria-label="Navegació mòbil">
              {links.map(({ href, label, icon: Icon }) => (
                <SheetClose
                  key={href}
                  render={
                    <Link
                      href={href}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground",
                        isActive(href) && "bg-muted text-foreground",
                      )}
                    />
                  }
                >
                  <Icon className="size-4" />
                  {label}
                </SheetClose>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
