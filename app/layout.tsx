
import AskRecords from "@/components/ask-records";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";

import "./globals.css";
import "./experience.css";
import "./landing.css";
import "./editorial.css";
import "./brand.css";
import "./room.css";
import "./marks.css";

export const metadata: Metadata = {
  title: "dwelld. — Your room remembers",
  description: "A clear, timestamped record of your room.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <AskRecords />
        <Analytics />
      </body>
    </html>
  );
}

