import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "RelayHUD — Multi-Account AI Orchestration HUD",
  description:
    "Live telemetry, auto-routing, failover bus, and streaming log HUD across 2 Google accounts and 1 Claude account.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark`}
    >
      <body className="min-h-[100dvh] bg-[var(--bg-canvas)] text-[var(--text-primary)] selection:bg-[#56b868]/30 selection:text-white">
        {children}
      </body>
    </html>
  );
}
