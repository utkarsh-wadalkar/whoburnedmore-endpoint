import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WhoBurnedMore Cards | Official share-card images",
  description: "A public image endpoint for official WhoBurnedMore share cards.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
