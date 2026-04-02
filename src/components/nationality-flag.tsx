"use client";

import { useMemo, useState } from "react";
import { formatNationalityCode, getNationalityFlag, getNationalityFlagCode } from "@/lib/nationality";

export default function NationalityFlag({
  input,
  className = "",
  title,
}: {
  input: string;
  className?: string;
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  const flagEmoji = useMemo(() => getNationalityFlag(input), [input]);
  const flagCode = useMemo(() => getNationalityFlagCode(input), [input]);
  const label = title || formatNationalityCode(input || "—");

  if (!flagCode || failed) {
    return (
      <span className={className} aria-hidden="true" title={label}>
        {flagEmoji || "—"}
      </span>
    );
  }

  return (
    <img
      src={`https://flagcdn.com/24x18/${flagCode}.png`}
      alt={label}
      title={label}
      width={18}
      height={14}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
