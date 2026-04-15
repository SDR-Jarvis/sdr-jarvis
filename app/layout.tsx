import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SDR Jarvis — AI outbound for solo founders",
  description:
    "AI-powered outbound for solo founders. Your first sales hire — minus the salary. Jarvis researches each lead and drafts email; you approve every send.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
