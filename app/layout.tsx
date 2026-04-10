import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SDR Jarvis — Your AI Sales Development Rep",
  description:
    "Crush outbound without burnout. Jarvis researches prospects, writes hyper-personalized emails, and books meetings — with your approval on every send.",
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
