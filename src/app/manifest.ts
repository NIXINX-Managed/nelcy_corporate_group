import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nelcy Corporate Group | Financial Control",
    short_name: "Nelcy Finance",
    description: "Control financiero de empresas y recursos personales",
    id: "/",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1425",
    theme_color: "#0b1425",
    lang: "es",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
