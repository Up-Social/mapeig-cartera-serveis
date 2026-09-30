"use client";

import { useEffect, useRef, type FormHTMLAttributes, type ReactNode } from "react";

export function AutoFilterForm({ children, ...props }: FormHTMLAttributes<HTMLFormElement> & { children: ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <form {...props} ref={form} onChange={event => {
    props.onChange?.(event);
    if (timer.current) clearTimeout(timer.current);
    if (event.target instanceof HTMLSelectElement) form.current?.requestSubmit();
    else timer.current = setTimeout(() => form.current?.requestSubmit(), 350);
  }} onSubmit={event => {
    if (timer.current) clearTimeout(timer.current);
    props.onSubmit?.(event);
  }}>{children}</form>;
}
