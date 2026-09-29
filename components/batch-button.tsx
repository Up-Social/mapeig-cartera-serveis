import type { ComponentProps } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import styles from "./batch-button.module.css";

type BatchButtonSize = "default" | "xs" | "sm" | "lg";

const contrastClasses = cn("batch-action", styles.action);
const selectedClasses = cn("batch-action-selected", styles.selected);

export function batchButtonVariants({
  size = "default",
  selected = false,
  className,
}: {
  size?: BatchButtonSize;
  selected?: boolean;
  className?: string;
} = {}) {
  return cn(
    buttonVariants({ variant: "outline", size }),
    contrastClasses,
    selected && selectedClasses,
    className,
  );
}

type BatchButtonProps = Omit<ComponentProps<typeof Button>, "variant"> & {
  selected?: boolean;
};

export function BatchButton({
  selected = false,
  className,
  ...props
}: BatchButtonProps) {
  return (
    <Button
      {...props}
      variant="outline"
      data-selected={selected ? "true" : undefined}
      aria-pressed={props["aria-pressed"] ?? (selected ? true : undefined)}
      className={cn(
        contrastClasses,
        selected && selectedClasses,
        className,
      )}
    />
  );
}
