import { IBM_Plex_Sans_Thai } from "next/font/google";
import { Metadata } from "next";

const thaiUi = IBM_Plex_Sans_Thai({
  weight: ["400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Linen Mobile | Hotel PMS",
  description: "Mobile App for Linen & Laundry FO",
};

export default function LinenMobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${thaiUi.className} min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-300`}>
      <main className="flex-1 w-full mx-auto">
        {children}
      </main>
    </div>
  );
}
