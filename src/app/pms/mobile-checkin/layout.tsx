export default function MobileCheckinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--bg-muted)] overflow-hidden">
      {/* Mobile constraint container. Keeps the app feeling like a phone even on desktop. */}
      <div className="max-w-lg mx-auto bg-[var(--bg-surface)] min-h-screen shadow-2xl flex flex-col relative overflow-y-auto pb-safe">
        {children}
      </div>
    </div>
  );
}
