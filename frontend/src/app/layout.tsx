import type { Metadata, Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { InAppBrowserNotice } from "@/components/InAppBrowserNotice";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Curtain",
  description: "Pay-on-entry tickets. If the curtain never rises, your money comes back.",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#120d0c" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#content"
          className="sr-only rounded-xl bg-velvet px-4 py-2 font-semibold text-velvet-ink focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
        >
          Skip to content
        </a>
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-5 pb-2 lg:px-8">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Image src="/logo.png" alt="" width={32} height={32} priority className="rounded-lg" /> Curtain
          </Link>
          <nav aria-label="Main" className="flex items-center gap-0.5 text-sm font-medium whitespace-nowrap sm:gap-2">
            <Link href="/shows" className="rounded-full px-2 py-1.5 text-muted hover:text-foreground sm:px-3">
              Shows
            </Link>
            <Link href="/tickets" className="rounded-full border border-line px-2.5 py-1.5 sm:px-3">
              My tickets
            </Link>
            <Link href="/organizer" className="rounded-full px-2 py-1.5 text-muted hover:text-foreground sm:px-3">
              <span className="sm:hidden">Organizers</span>
              <span className="hidden sm:inline">For organizers</span>
            </Link>
          </nav>
        </header>
        <InAppBrowserNotice />
        <div id="content" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 lg:px-8">
          {children}
        </div>
        <footer className="border-t border-line">
          <nav
            aria-label="Footer"
            className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted lg:px-8"
          >
            <Link href="/#how-it-works" className="hover:text-foreground">
              How it works
            </Link>
            <Link href="/board/demo" className="hover:text-foreground">
              Money board
            </Link>
            <a href="https://www.monad.xyz" target="_blank" rel="noopener" className="hover:text-foreground">
              Built on Monad
            </a>
            <a href="https://github.com/abdoulore/Curtain" target="_blank" rel="noopener" className="hover:text-foreground">
              GitHub
            </a>
          </nav>
        </footer>
      </body>
    </html>
  );
}
