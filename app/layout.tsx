import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { Sidebar } from "./components/sidebar";
import { ThemeProvider } from "./components/theme-provider";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cascade — Delamain",
  description:
    "A nerve center for orchestrating multi-project Claude Code workflows.",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full`}
      data-theme="dark"
    >
      <body className="h-full flex scanlines">
        <ThemeProvider>
          <Sidebar />
          <main className="flex-1 min-h-full overflow-auto lg:ml-0 p-6 pt-14 lg:pt-6">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
