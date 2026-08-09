import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "langlearn",
  description:
    "Graded language courses: numbered grammar rules, vocabulary, and examination-style drills.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-rule">
          <nav className="mx-auto flex max-w-3xl items-baseline gap-6 px-6 py-4 text-sm">
            <Link href="/" className="font-semibold tracking-tight">
              langlearn
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
