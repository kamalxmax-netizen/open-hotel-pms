import * as React from "react";

function cn(...classes: Array<string | undefined | false | null>) {
  return classes.filter(Boolean).join(" ");
}

type SelectOption = { value: string; label: string };

type SelectContextType = {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  options: SelectOption[];
};

const SelectContext = React.createContext<SelectContextType>({ options: [] });

function collectOptions(node: React.ReactNode, out: SelectOption[] = []): SelectOption[] {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;
    const elementType = (child.type as any)?.displayName;

    if (elementType === "SelectItem") {
      const value = child.props.value;
      const label = React.Children.toArray(child.props.children).join("");
      if (typeof value === "string") {
        out.push({ value, label });
      }
      return;
    }

    if (child.props?.children) {
      collectOptions(child.props.children, out);
    }
  });
  return out;
}

export function Select({
  value,
  onValueChange,
  disabled,
  children,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const options = React.useMemo(() => collectOptions(children), [children]);

  return (
    <SelectContext.Provider value={{ value, onValueChange, disabled, options }}>
      <div className="w-full">{children}</div>
    </SelectContext.Provider>
  );
}

export function SelectTrigger({
  className,
  disabled,
  children,
}: {
  className?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const ctx = React.useContext(SelectContext);
  const hasCurrentValue = typeof ctx.value === "string" && ctx.options.some((option) => option.value === ctx.value);
  const currentValue = hasCurrentValue ? ctx.value : "";

  let placeholder: string | undefined;
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if ((child.type as any)?.displayName === "SelectValue") {
      placeholder = child.props.placeholder;
    }
  });

  return (
    <select
      className={cn("form-select", className)}
      value={currentValue}
      onChange={(event) => ctx.onValueChange?.(event.target.value)}
      disabled={ctx.disabled || disabled}
    >
      {placeholder && !hasCurrentValue && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {ctx.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function SelectValue(_props: { placeholder?: string }) {
  return null;
}

export function SelectContent({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function SelectItem(_props: { value: string; children: React.ReactNode }) {
  return null;
}

SelectTrigger.displayName = "SelectTrigger";
SelectValue.displayName = "SelectValue";
SelectContent.displayName = "SelectContent";
SelectItem.displayName = "SelectItem";
