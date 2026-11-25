import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

// Fonts are bundled by the `geist` package, so builds never need network access to Google Fonts.

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
      className={`${GeistSans.variable} ${GeistMono.variable} dark`}
    >
      <body className="min-h-[100dvh] bg-[var(--bg-canvas)] text-[var(--text-primary)] selection:bg-[#56b868]/30 selection:text-white">
        {children}
      </body>
    </html>
  );
}
