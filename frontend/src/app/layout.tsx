import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono, Space_Grotesk, DM_Sans } from "next/font/google";
import { ThemeProvider } from "../components/ThemeProvider";
import { ToastProvider } from "../components/Toast";
import { CookieBanner } from "../components/CookieBanner";
import { CommandPalette } from "../components/CommandPalette";
import "./globals.css";

// Design-system fonts: DM Sans for text, Space Grotesk for display, JetBrains Mono for
// code and model names. Instrument Serif stays only until the old headings are
// redesigned (E2 rollout); Inter was dropped (globals.css maps font-inter to DM Sans).
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  weight: "400",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
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
        className={`${jetbrainsMono.variable} ${instrumentSerif.variable} ${spaceGrotesk.variable} ${dmSans.variable} h-full bg-canvas text-ink font-sans flex flex-col selection:bg-accent selection:text-accent-fg overflow-hidden`}
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
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
