import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AGRON Workspace",
  description: "AGRON Inc. operating workspace — technical, operations, finance, sales, marketing, security, legal and HR.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" />
        <style dangerouslySetInnerHTML={{ __html: `:root{--font-display:"Unbounded";--font-body:"IBM Plex Sans";--font-arabic:"IBM Plex Sans Arabic";--font-mono:"JetBrains Mono"}` }} />
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("agronws.theme");if(t)document.documentElement.setAttribute("data-theme",t);var l=localStorage.getItem("agronws.lang");if(l){document.documentElement.lang=l;document.documentElement.dir=l==="ar"?"rtl":"ltr"}}catch(e){}` }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
