import { ImageResponse } from "next/og";

/** Icônes de l'application : « B » blanc sur fond noir, comme le logo du site. `maskable-512` laisse une marge de sécurité. */
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: raw } = await params;
  const maskable = raw.startsWith("maskable-");
  const size = Number(raw.replace("maskable-", ""));
  if (![180, 192, 512].includes(size)) return new Response("Not found", { status: 404 });
  // Le « B » occupe 50 % de la hauteur (40 % pour l'icône « maskable ») : les bords restent libres pour les formes arrondies.
  const mark = Math.round(size * (maskable ? 0.4 : 0.5));
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#111113" }}>
        <svg width={Math.round((mark * 12) / 16)} height={mark} viewBox="10 8 12 16">
          <path d="M11 9h6.2a3.6 3.6 0 0 1 2.2 6.45A3.9 3.9 0 0 1 17.6 23H11V9Zm2.6 2.3v3.6h3.4a1.8 1.8 0 0 0 0-3.6h-3.4Zm0 5.9v3.5h3.9a1.75 1.75 0 0 0 0-3.5h-3.9Z" fill="#ffffff" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400, immutable" } },
  );
}
