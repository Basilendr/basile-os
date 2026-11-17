import { ImageResponse } from "next/og";
import { LOGO_B } from "@/components/shell/logo";

/** Icônes de l'application : le logo du site (« B » blanc tracé, point bleu, fond verre sombre). `maskable-512` laisse une marge de sécurité. */
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: raw } = await params;
  const maskable = raw.startsWith("maskable-");
  const size = Number(raw.replace("maskable-", ""));
  if (![180, 192, 512].includes(size)) return new Response("Not found", { status: 404 });
  // Le dessin occupe 70 % de l'icône (55 % pour l'icône « maskable ») : les bords restent libres pour les formes arrondies.
  const mark = Math.round(size * (maskable ? 0.55 : 0.7));
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", backgroundImage: "linear-gradient(180deg, #2c3140 0%, #0c0e13 100%)" }}>
        <svg width={mark} height={mark} viewBox="6 5 22 22">
          <path d={LOGO_B} fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="23.4" cy="9.3" r="2.3" fill="#5b9dff" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400, immutable" } },
  );
}
