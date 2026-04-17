import { IBM_Plex_Sans_Thai } from "next/font/google";

const thaiFont = IBM_Plex_Sans_Thai({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["thai", "latin"],
  display: "swap",
  variable: "--font-thai",
});

export default function MonthlyMegaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${thaiFont.variable} font-thai`}>
      {children}
    </div>
  );
}
