import type { Metadata, Viewport } from "next";
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#120d0c" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="mx-auto flex w-full max-w-xl items-center justify-between px-4 pt-5 pb-2">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            <span className="text-velvet">●</span> Curtain
          </Link>
          <Link href="/tickets" className="rounded-full border border-line px-3 py-1.5 text-sm font-medium">
            My tickets
          </Link>
        </header>
        <InAppBrowserNotice />
        <div className="mx-auto w-full max-w-xl flex-1 px-4 pb-16">{children}</div>
      </body>
    </html>
  );
}
