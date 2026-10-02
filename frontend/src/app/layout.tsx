import type { Metadata } from "next";
import { Newsreader, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "../components/ThemeProvider";
import { ToastProvider } from "../components/Toast";
import { CookieBanner } from "../components/CookieBanner";
import { CommandPalette } from "../components/CommandPalette";
import { TooltipLayer } from "../components/ui/TooltipLayer";
import "./globals.css";

// DESIGN.md 4.1: only three families load app-wide. Newsreader for headings
// (font-display), Hanken Grotesk for text (font-sans / font-body), JetBrains Mono for
// code, timestamps and model names. This replaces Space Grotesk, DM Sans and
// Instrument Serif everywhere, including the old font-serif headings (home, profile,
// settings, 404), which now point at font-display instead.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Choir — Multiplayer AI",
  description: "A collaborative workspace where your team and AI share context.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body
        className={`${jetbrainsMono.variable} ${newsreader.variable} ${hankenGrotesk.variable} h-full bg-bg text-fg font-sans flex flex-col selection:bg-primary selection:text-on-primary overflow-hidden`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ToastProvider>
            {children}
            <CommandPalette />
            <CookieBanner />
            <TooltipLayer />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
