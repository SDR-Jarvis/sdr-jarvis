import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SDR Jarvis — AI outbound for solo founders",
  description:
    "AI-powered outbound for solo founders. Your first sales hire — minus the salary. Jarvis researches each lead and drafts email; you approve every send.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a1a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh overflow-x-hidden antialiased">{children}</body>
    </html>
  );
}
