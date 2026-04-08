"use client";

type VehicleCountryFlagProps = {
  country: "TH" | "MY";
  className?: string;
};

function joinClasses(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function VehicleCountryFlag({ country, className }: VehicleCountryFlagProps) {
  if (country === "MY") {
    return (
      <span
        className={joinClasses("relative inline-block h-4 w-6 overflow-hidden rounded-[3px] border border-slate-300 shadow-sm", className)}
        title="Malaysia"
        aria-label="Malaysia"
      >
        <span className="absolute inset-0 bg-[repeating-linear-gradient(to_bottom,#ef4444_0,#ef4444_2px,#ffffff_2px,#ffffff_4px)]" />
        <span className="absolute left-0 top-0 h-[65%] w-[50%] bg-[#1d4ed8]" />
        <span className="absolute left-[4px] top-[2px] h-[7px] w-[7px] rounded-full border-[2px] border-[#facc15] border-r-transparent" />
        <span className="absolute left-[10px] top-[3px] text-[6px] leading-none text-[#facc15]">✦</span>
      </span>
    );
  }

  return (
    <span
      className={joinClasses("inline-block h-4 w-6 overflow-hidden rounded-[3px] border border-slate-300 shadow-sm bg-[linear-gradient(to_bottom,#ef4444_0%,#ef4444_20%,#ffffff_20%,#ffffff_40%,#1d4ed8_40%,#1d4ed8_60%,#ffffff_60%,#ffffff_80%,#ef4444_80%,#ef4444_100%)]", className)}
      title="Thailand"
      aria-label="Thailand"
    />
  );
}
