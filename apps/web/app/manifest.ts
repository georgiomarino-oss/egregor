import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Egregor",
    short_name: "Egregor",
    description:
      "Egregor is a collective intention platform helping people turn reflection into meaningful action.",
    start_url: "/",
    display: "standalone",
    background_color: "#071423",
    theme_color: "#117790",
    icons: [
      {
        src: "/brand/egregor-icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/brand/egregor-icon-512.png",
        sizes: "512x512",
        type: "image/png"
      }
    ]
  };
}
