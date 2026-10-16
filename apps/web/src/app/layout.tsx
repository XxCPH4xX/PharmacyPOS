import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/roboto-condensed";
import "./globals.css";

export const metadata: Metadata = {
  title: "PharmaCore — Pharmacy Workspace",
  description:
    "Connected medicine inventory, batch tracking, and pharmacy point of sale.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
