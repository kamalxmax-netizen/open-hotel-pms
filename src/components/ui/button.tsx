import * as React from "react";

type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive";
type ButtonSize = "default" | "sm" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

function cn(...classes: Array<string | undefined | false | null>) {
  return classes.filter(Boolean).join(" ");
}

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-brand-600 text-white hover:bg-brand-700",
  outline: "border border-[var(--border-input)] bg-[var(--bg-surface)] text-[var(--text-table-cell)] hover:bg-[var(--bg-surface-hover)]",
  secondary: "bg-[var(--bg-muted)] text-[var(--text-primary)] hover:bg-[var(--bg-muted)]",
  ghost: "bg-transparent text-[var(--text-table-cell)] hover:bg-[var(--bg-surface-hover)]",
  destructive: "bg-rose-600 text-white hover:bg-rose-700",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-10 px-4 py-2 text-sm",
  sm: "h-8 px-3 text-sm",
  icon: "h-10 w-10 p-0",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
