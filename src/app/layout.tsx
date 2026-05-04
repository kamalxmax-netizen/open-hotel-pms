import type { Metadata } from "next";
import "./globals.css";
import "@/styles/print.css";
import "@/styles/logbook-theme.css";
import AppShell from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { LostFoundPopupProvider } from "@/components/providers/lost-found-popup-context";

export const metadata: Metadata = {
  title: "OpenHotel PMS",
  description: "OpenHotel — Internal Staff Portal",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            if (localStorage.getItem('theme') === 'dark') {
              document.documentElement.classList.add('dark');
            }
          } catch(e) {}
        `}} />
      </head>
      <body>
        <ThemeProvider>
          <LostFoundPopupProvider>
            <AppShell>{children}</AppShell>
          </LostFoundPopupProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
