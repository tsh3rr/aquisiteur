import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aquisiteur Cockpit",
    short_name: "Aquisiteur",
    start_url: "/",
    display: "standalone",
    lang: "de",
    background_color: "#fbfbfe",
    theme_color: "#4f3bd9",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
