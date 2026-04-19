"use client";

import { Bell, Moon, Search, Sun } from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { useTheme } from "@/components/theme-provider";

type PmsCommandTopbarProps = {
  title: string;
  thaiTitle?: string;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchReadOnly?: boolean;
  showAlerts?: boolean;
  hasUnreadAlerts?: boolean;
  showThemeToggle?: boolean;
  avatarLabel?: string;
  actions?: ReactNode;
  className?: string;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function PmsCommandTopbar({
  title,
  thaiTitle,
  searchPlaceholder = "Search rooms, guests, bookings...",
  searchValue = "",
  onSearchChange,
  searchReadOnly,
  showAlerts = true,
  hasUnreadAlerts = false,
  showThemeToggle = true,
  avatarLabel = "NA",
  actions,
  className,
}: PmsCommandTopbarProps) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  const isSearchReadOnly = searchReadOnly ?? !onSearchChange;

  function handleSearchChange(event: ChangeEvent<HTMLInputElement>) {
    onSearchChange?.(event.target.value);
  }

  return (
    <header
      className={cx(
        "sticky top-0 z-20 flex h-[65px] items-center gap-5 border-b border-[#e4ded0] bg-white px-7 dark:border-white/10 dark:bg-[#10231f]",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="truncate font-serif text-[28px] font-semibold leading-none text-[#2b2721] dark:text-[#f8f1e5]">
          {title}
        </h1>
        {thaiTitle && <span className="truncate text-sm font-semibold text-[#b9883a]">{thaiTitle}</span>}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <label className="relative block">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#857e6e] dark:text-white/45" />
          <input
            readOnly={isSearchReadOnly || !onSearchChange}
            value={searchValue}
            onChange={handleSearchChange}
            placeholder={searchPlaceholder}
            className="h-10 w-[min(380px,42vw)] rounded-full border border-[#e4ded0] bg-[#fbf7ef] pl-10 pr-4 text-sm text-[#2b2721] outline-none transition placeholder:text-[#857e6e] focus:border-[#1f4a3f] dark:border-white/10 dark:bg-[#091713] dark:text-[#f8f1e5] dark:placeholder:text-white/35"
          />
        </label>

        {actions}

        {showAlerts && (
          <button
            type="button"
            className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[#2b2721] transition hover:bg-[#f7f1e8] dark:text-[#f5efe2] dark:hover:bg-white/10"
            aria-label="Mock alerts"
          >
            <Bell className="h-4 w-4" />
            {hasUnreadAlerts && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#c04a3b]" />}
          </button>
        )}

        {showThemeToggle && (
          <button
            type="button"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#2b2721] transition hover:bg-[#f7f1e8] dark:text-[#f5efe2] dark:hover:bg-white/10"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            title={isDark ? "Light mode" : "Dark mode"}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        )}

        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#b9883a] text-sm font-semibold text-[#173f36]">
          {avatarLabel}
        </div>
      </div>
    </header>
  );
}
