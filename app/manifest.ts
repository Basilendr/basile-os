import type { MetadataRoute } from "next";

/** Application installable (PWA) : icône, plein écran, raccourcis vers les pages les plus utilisées. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Basile OS",
    short_name: "Basile OS",
    description: "Système d'exploitation personnel augmenté par l'IA",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0b0c",
    theme_color: "#0b0b0c",
    lang: "fr",
    icons: [
      { src: "/api/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/api/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/api/pwa-icon/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Aujourd'hui", url: "/today", icons: [{ src: "/api/pwa-icon/192", sizes: "192x192" }] },
      { name: "Quiz", url: "/quiz", icons: [{ src: "/api/pwa-icon/192", sizes: "192x192" }] },
      { name: "Pomodoro", url: "/school?tab=focus", icons: [{ src: "/api/pwa-icon/192", sizes: "192x192" }] },
      { name: "Emploi du temps", url: "/school?tab=timetable", icons: [{ src: "/api/pwa-icon/192", sizes: "192x192" }] },
    ],
  };
}
