import type { Metadata, Viewport } from "next";
import { Onest } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const onest = Onest({ variable: "--font-onest", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "TourIQ pipeline",
  description: "Sales pipeline module",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light",
  themeColor: "#F5F6F8",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={onest.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
