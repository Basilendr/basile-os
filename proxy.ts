import { NextResponse, type NextRequest } from "next/server";

/** Garde de navigation : sans cookie de session, redirection vers /login (la validation réelle est côté serveur). */
export function proxy(req: NextRequest) {
  // En production, une seule adresse : les URL propres à chaque déploiement (basile-xxxx.vercel.app)
  // renvoient vers APP_URL, sinon la session et la connexion Google se retrouvent sur deux domaines.
  const appUrl = process.env.APP_URL;
  if (process.env.VERCEL_ENV === "production" && appUrl) {
    const target = new URL(appUrl);
    if (req.nextUrl.host !== target.host) {
      return NextResponse.redirect(new URL(req.nextUrl.pathname + req.nextUrl.search, target), 308);
    }
  }
  const has = req.cookies.has("bos_session");
  const { pathname, search } = req.nextUrl;
  if (!has && pathname !== "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
