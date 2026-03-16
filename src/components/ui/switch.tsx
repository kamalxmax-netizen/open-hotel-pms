import * as React from "react";

function cn(...classes: Array<string | undefined | false | null>) {
  return classes.filter(Boolean).join(" ");
}

export interface SwitchProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked = false, onCheckedChange, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50",
        checked ? "bg-brand-600" : "bg-[var(--bg-muted)]",
        className
      )}
      onClick={() => onCheckedChange?.(!checked)}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-[var(--bg-surface)] shadow transition",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
