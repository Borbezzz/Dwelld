import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "dwelld. — Your room remembers", description: "A clear, timestamped record of your room's condition." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
