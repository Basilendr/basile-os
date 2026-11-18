import { ImageResponse } from "next/og";
import { LOGO_B } from "@/components/shell/logo";

export const alt = "Basile OS";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Aperçu d'un lien partagé : logo et nom de l'app, sur le verre sombre du site. */
export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", gap: 48, padding: "0 110px", backgroundImage: "linear-gradient(160deg, #2c3140 0%, #0c0e13 70%)", color: "#ffffff" }}>
        <svg width={220} height={220} viewBox="6 5 22 22">
          <path d={LOGO_B} fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="23.4" cy="9.3" r="2.3" fill="#5b9dff" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 92, fontWeight: 700, letterSpacing: -3 }}>Basile OS</div>
          <div style={{ fontSize: 34, color: "#c4c9d6", marginTop: 10 }}>L'école, les révisions et l'organisation de Basile.</div>
        </div>
      </div>
    ),
    size,
  );
}
