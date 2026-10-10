import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AGRON Workspace", short_name: "AGRON", description: "AGRON Inc. company workspace",
    start_url: "/", display: "standalone", background_color: "#071019", theme_color: "#141A21",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }],
  };
}
