import { IBM_Plex_Sans_Thai } from "next/font/google";

const thaiUi = IBM_Plex_Sans_Thai({
  weight: ["400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  display: "swap",
});

export default function MaidLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${thaiUi.className} min-h-screen bg-slate-100 text-slate-900`}>
      <main className="flex-1 w-full mx-auto">
        {children}
      </main>
    </div>
  );
}
