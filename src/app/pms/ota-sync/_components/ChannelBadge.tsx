export function ChannelBadge({ channelId }: { channelId: string }) {
  const normalized = channelId.trim().toLowerCase();

  if (normalized === "booking" || normalized === "booking.com") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold" style={{ backgroundColor: "var(--brand-booking-bg)", color: "var(--brand-booking-text)" }}>
        Booking.com
      </span>
    );
  }
  
  if (normalized === "agoda") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-purple-600 text-white">
        Agoda
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-300 capitalize">
      {channelId}
    </span>
  );
}
