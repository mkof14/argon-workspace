import type { MetadataRoute } from "next";
/** Installable app: home-screen icon, full-screen window, shortcuts, and "Share to AGRON" for files from other apps. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "AGRON Workspace", short_name: "AGRON", description: "AGRON Inc. company workspace",
    start_url: "/?source=app", scope: "/", display: "standalone", orientation: "any",
    background_color: "#0C1015", theme_color: "#141A21",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Upload a document", short_name: "Upload", url: "/?upload=1", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Ask documents", short_name: "Ask", url: "/ask", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "StarDome configurations", short_name: "StarDome", url: "/stardome", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
    share_target: {
      action: "/share-target", method: "POST", enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url", files: [{ name: "files", accept: ["application/pdf", "image/*", "text/*", ".pdf", ".docx", ".xlsx", ".pptx", ".csv", ".txt"] }] },
    } as any,
  };
}
