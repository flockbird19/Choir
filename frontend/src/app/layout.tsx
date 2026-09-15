import type { Metadata } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono, Space_Grotesk, DM_Sans } from "next/font/google";
import { ThemeProvider } from "../components/ThemeProvider";
import { ToastProvider } from "../components/Toast";
import { CookieBanner } from "../components/CookieBanner";
import { CommandPalette } from "../components/CommandPalette";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-sans",
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
        className={`${inter.variable} ${jetbrains.variable} ${instrumentSerif.variable} ${spaceGrotesk.variable} ${dmSans.variable} h-full bg-canvas text-ink font-sans flex flex-col selection:bg-accent selection:text-accent-fg overflow-hidden`}
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
