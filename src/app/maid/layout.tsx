export default function MaidLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* 
        Top Bar - Removed side padding slightly to max space
        Using sticky top-0 to stay on screen
      */}
      <header className="sticky top-0 z-40 w-full bg-white border-b border-slate-200 shadow-sm">
        <div className="flex h-14 items-center gap-3 px-4">
          <div className="flex-1">
            <h1 className="text-lg font-bold text-slate-900 leading-tight">Housekeeping</h1>
            <p className="text-[10px] text-slate-500 font-medium">Maid Connect App</p>
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
