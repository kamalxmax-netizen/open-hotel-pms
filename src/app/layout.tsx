import type { Metadata } from "next";
import "./globals.css";
import "@/styles/print.css";
import AppShell from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Hotel PMS",
  description: "Unified PMS + Housekeeping platform",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
