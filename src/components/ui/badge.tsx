import * as React from "react";

function cn(...classes: Array<string | undefined | false | null>) {
  return classes.filter(Boolean).join(" ");
}

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400 dark:border dark:border-brand-500/20",
  secondary: "bg-[var(--bg-muted)] text-[var(--text-table-cell)] dark:bg-slate-800 dark:text-slate-300 dark:border dark:border-slate-700",
  outline: "border border-[var(--border-input)] bg-[var(--bg-surface)] text-[var(--text-table-cell)]",
  destructive: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 dark:border dark:border-rose-500/30",
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", variantClasses[variant], className)}
      {...props}
    />
  );
}
