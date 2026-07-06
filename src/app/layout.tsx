import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "sleep",
  description: "where do we go from here?",
  // Favicon is auto-detected from src/app/icon.svg (Next.js 15
  // app router convention) — no explicit `icons` field needed.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (Grammarly et al.)
          inject attributes like data-gr-ext-installed into <body> before
          React hydrates, tripping a false hydration mismatch. This flag
          only suppresses ATTRIBUTE diffs on this one element — child
          content is still fully hydration-checked. */}
      <body className={`${inter.className} bg-black`} suppressHydrationWarning>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
