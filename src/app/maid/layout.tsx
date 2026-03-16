export default function MaidLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--bg-body)] flex flex-col">
      {/* 
        Top Bar - Removed side padding slightly to max space
        Using sticky top-0 to stay on screen
      */}
      <header className="sticky top-0 z-40 w-full bg-[var(--bg-surface)] border-b border-[var(--border-default)] shadow-sm">
        <div className="flex h-14 items-center gap-3 px-4">
          <div className="flex-1">
            <h1 className="text-lg font-bold text-[var(--text-primary)] leading-tight">Housekeeping</h1>
            <p className="text-[10px] text-[var(--text-muted)] font-medium">Maid Connect App</p>
          </div>
        </div>
      </header>
      
      {/* 
        Main content for the Maid App
        Padding top for the sticky header
      */}
      <main className="flex-1 w-full max-w-md mx-auto">
        {children}
      </main>
    </div>
  );
}
