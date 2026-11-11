import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Chess Coach",
  description: "Review your Chess.com games with an engine-backed coach.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
