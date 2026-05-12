"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function TransferQRPage() {
  const params = useParams();
  const router = useRouter();
  const resId = params.resId as string;

  useEffect(() => {
    const savedResult = sessionStorage.getItem(`mobile-checkin-result-${resId}`);
    router.replace(savedResult ? `/pms/mobile-checkin/success/${resId}` : "/pms/mobile-checkin");
  }, [resId, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-muted)] px-6">
      <div className="flex items-center gap-3 text-[var(--text-secondary)]">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="font-bold">กำลังกลับไปหน้าสรุป Mobile Check-in...</p>
      </div>
    </div>
  );
}
