import * as React from "react";

function cn(...classes: Array<string | undefined | false | null>) {
  return classes.filter(Boolean).join(" ");
}

type ToggleGroupContextType = {
  value?: string;
  onValueChange?: (value: string) => void;
};

const ToggleGroupContext = React.createContext<ToggleGroupContextType>({});

export function ToggleGroup({
  value,
  onValueChange,
  className,
  children,
}: {
  type?: "single";
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <ToggleGroupContext.Provider value={{ value, onValueChange }}>
      <div className={cn("inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white p-1", className)}>
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
}

export function ToggleGroupItem({
  value,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const ctx = React.useContext(ToggleGroupContext);
  const active = ctx.value === value;

  return (
    <button
      type="button"
      className={cn(
        "rounded px-2.5 py-1.5 text-sm font-medium transition",
        active ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100",
        className
      )}
      onClick={() => ctx.onValueChange?.(value)}
      {...props}
    >
      {children}
    </button>
  );
}
