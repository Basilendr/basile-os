import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { eq } from "drizzle-orm";
import "./globals.css";
import { Providers } from "./providers";
import { currentUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";

export const metadata: Metadata = {
  title: { default: "Basile OS", template: "%s · Basile OS" },
  description: "Système d'exploitation personnel augmenté par l'IA",
  applicationName: "Basile OS",
  icons: { icon: "/api/pwa-icon/192", apple: "/api/pwa-icon/180" },
  appleWebApp: { capable: true, title: "Basile OS", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9edf3" },
    { media: "(prefers-color-scheme: dark)", color: "#14161b" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  let theme = "light";
  let density = "comfortable";
  let accent = "#0071E3";
  if (user) {
    const db = await getDb();
    const [p] = await db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, user.id));
    if (p) ({ theme, density, accent } = p);
  }
  return (
    <html
      lang="fr"
      data-theme={theme === "system" ? undefined : theme}
      data-density={density}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      // Le bleu par défaut suit le thème (bleu plus clair en sombre).
      style={accent.toUpperCase() === "#0071E3" ? undefined : { ["--accent" as string]: accent }}
      suppressHydrationWarning
    >
      <body>
        {/* Fond d'écran choisi sur cet appareil, appliqué avant l'affichage. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var w=localStorage.getItem("bos.wallpaper");if(w)document.documentElement.dataset.wallpaper=w}catch(e){}` }} />
        {theme === "system" && (
          <script
            dangerouslySetInnerHTML={{
              __html: `document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'`,
            }}
          />
        )}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
