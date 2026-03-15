"use client";

import { useState } from "react";
import BookingWorkbench from "./booking-workbench";
import LiveBoard from "./live-board";

export default function PmsShell() {
  const [refreshToken, setRefreshToken] = useState<number>(0);

  return (
    <section className="space-y-5">
      <BookingWorkbench onReservationChanged={() => setRefreshToken((current) => current + 1)} />
      <LiveBoard refreshToken={refreshToken} />
    </section>
  );
}
