import "./globals.css";
import type { Metadata, Viewport } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://workspace.agron1.com";
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "AGRON Workspace", template: "%s · AGRON Workspace" },
  description: "AGRON Inc. company workspace for StarDome and AGRON 1 — projects, documents, approvals and the AGRON assistant.",
  applicationName: "AGRON Workspace",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  openGraph: { type: "website", siteName: "AGRON Workspace", title: "AGRON Workspace", description: "AGRON Inc. company workspace. Sign in with your work email.", images: [{ url: "/logo-full.webp", width: 640, height: 187, alt: "AGRON" }] },
  twitter: { card: "summary", title: "AGRON Workspace", description: "AGRON Inc. company workspace." },
  formatDetection: { telephone: false, email: false, address: false },
  appleWebApp: { capable: true, title: "AGRON", statusBarStyle: "default" },
  other: { "mobile-web-app-capable": "yes" },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ECEFF3" }, { media: "(prefers-color-scheme: dark)", color: "#0C1015" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="preload" as="image" href="/logo-full.webp" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@600&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;600&display=swap" />
        <style dangerouslySetInnerHTML={{ __html: `:root{--font-display:"Unbounded";--font-body:"IBM Plex Sans";--font-arabic:"IBM Plex Sans Arabic";--font-mono:ui-monospace}` }} />
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("agronws.theme");if(t)document.documentElement.setAttribute("data-theme",t);var l=localStorage.getItem("agronws.lang");if(l){document.documentElement.lang=l;document.documentElement.dir=l==="ar"?"rtl":"ltr"}}catch(e){}` }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
