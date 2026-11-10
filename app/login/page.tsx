import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { hasAnyUser } from "@/services/account";
import { AuthForm } from "./auth-form";
import { LogoMark } from "@/components/shell/logo";
import { googleConfigured } from "@/lib/secrets";

export const metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (await currentUser()) redirect("/");
  const db = await getDb();
  const setup = !(await hasAnyUser(db));
  const { next, error } = await searchParams;
  return (
    <main className="relative isolate grid min-h-dvh place-items-center overflow-hidden bg-bg px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
        <div className="absolute top-[-180px] left-1/2 size-[560px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--accent)_16%,transparent),transparent_65%)] blur-2xl" />
      </div>
      <div className="relative w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark size={44} />
          <h1 className="t-title mt-4">{setup ? "Bienvenue sur Basile OS" : "Connexion"}</h1>
          <p className="t-sub mt-1.5">
            {setup ? "Crée ton compte pour initialiser ton espace." : "Connecte-toi à ton espace personnel."}
          </p>
        </div>
        <AuthForm mode={setup ? "setup" : "login"} next={next?.startsWith("/") && !next.startsWith("//") ? next : "/"} google={googleConfigured()} initialError={error?.slice(0, 300) ?? null} />
        <p className="t-meta mt-6 text-center">
          Avec Google, aucun mot de passe n'est transmis à Basile OS : l'accès passe par OAuth et peut être révoqué à tout moment.
          {!setup && (
            <>
              <br />
              Mot de passe oublié : arrête le serveur puis lance <code className="font-mono">npm run account:password -- "nouveau-mot-de-passe"</code>.
            </>
          )}
        </p>
      </div>
    </main>
  );
}
