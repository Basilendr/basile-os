import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/shell/logo";

/** Mise en page des pages légales : lisibles sans compte, sur le fond de l'app. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="relative isolate min-h-dvh px-4 py-10">
      <div className="app-backdrop" aria-hidden />
      <article className="surface mx-auto w-full max-w-[720px] p-6 md:p-9">
        <Link href="/" className="mb-6 inline-flex items-center gap-2.5 text-[14px] font-semibold">
          <LogoMark size={28} />
          Basile OS
        </Link>
        <h1 className="title-glow">{title}</h1>
        <p className="t-meta mt-1">Mise à jour : {updated}</p>
        <div className="mt-6 flex flex-col gap-6 text-[14.5px] leading-relaxed text-fg-2 [&_h2]:mb-2 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_mark]:rounded [&_mark]:bg-[color-mix(in_srgb,var(--warning)_22%,transparent)] [&_mark]:px-1 [&_mark]:text-fg">
          {children}
        </div>
        <p className="t-meta mt-8">
          <Link href="/mentions-legales" className="hover:underline">
            Mentions légales
          </Link>
          {" · "}
          <Link href="/confidentialite" className="hover:underline">
            Confidentialité
          </Link>
        </p>
      </article>
    </main>
  );
}
