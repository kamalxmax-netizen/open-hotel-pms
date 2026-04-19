import { Suspense } from "react";
import MaterialOverviewClient from "./_components/MaterialOverviewClient";

export default function MaterialOverviewPage() {
  return (
    <Suspense fallback={<div className="p-6 a-muted text-sm">Loading material analytics...</div>}>
      <MaterialOverviewClient />
    </Suspense>
  );
}
