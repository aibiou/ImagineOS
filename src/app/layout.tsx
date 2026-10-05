import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ImagineOS — 想到了，就让它发生",
  description:
    "AI 原生的人类表达与视觉创造操作系统。不需要会剪辑、会摄影、会写 Prompt——说出你想表达的，AI 创作团队帮你完成。",
  keywords: ["ImagineOS", "AI 创作", "视频生成", "表达", "Creation Loop", "Remix"],
  openGraph: {
    title: "ImagineOS",
    description: "你想表达什么？AI 原生创作循环。",
    siteName: "ImagineOS",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
