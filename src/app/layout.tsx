import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Horeca Platform",
  description: "Centraal horecamanagementsysteem voor de groep",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
