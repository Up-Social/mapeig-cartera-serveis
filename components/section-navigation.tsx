"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type SectionItem = { href: string; label: string };

export function SectionNavigation({
  label,
  items,
}: {
  label: string;
  items: readonly SectionItem[];
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const RESULT_SECTIONS = [
  { href: "/approved", label: "Aprovats" },
  { href: "/discarded", label: "Descartats" },
  { href: "/analysis", label: "Fora de cartera" },
] as const;

export const REFERENCE_SECTIONS = [
  { href: "/catalog", label: "Catàleg" },
  { href: "/entities", label: "Entitats" },
] as const;
