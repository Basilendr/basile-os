import { LegalPage } from "../legal-page";

export const metadata = { title: "Mentions légales" };

/** Les champs surlignés (TODO) sont à remplir par l'éditeur du site : aucune information n'est inventée ici. */
export default function Page() {
  return (
    <LegalPage title="Mentions légales" updated="18 novembre 2026">
      <section>
        <h2>Le site</h2>
        <p>Basile OS est une application personnelle et privée : l'accès est réservé au compte de son propriétaire. Aucun service n'est vendu ni proposé au public.</p>
      </section>
      <section>
        <h2>Éditeur et responsable de la publication</h2>
        <ul>
          <li>
            Nom : <mark>TODO nom et prénom de l'éditeur (ou de son représentant légal)</mark>
          </li>
          <li>
            Contact : <mark>TODO adresse e-mail de contact</mark>
          </li>
        </ul>
      </section>
      <section>
        <h2>Hébergement</h2>
        <ul>
          <li>
            Site : Vercel Inc., <a href="https://vercel.com" className="text-accent underline-offset-2 hover:underline">vercel.com</a>. Adresse postale : <mark>TODO à recopier depuis vercel.com/legal</mark>
          </li>
          <li>
            Base de données : Neon (<a href="https://neon.tech" className="text-accent underline-offset-2 hover:underline">neon.tech</a>), serveurs situés aux États-Unis (région us-east-1).
          </li>
        </ul>
      </section>
      <section>
        <h2>Crédits</h2>
        <p>Photos des fonds d'écran : Pexels, utilisées sous la licence Pexels.</p>
      </section>
    </LegalPage>
  );
}
