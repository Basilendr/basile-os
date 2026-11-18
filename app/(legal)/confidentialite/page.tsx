import { LegalPage } from "../legal-page";

export const metadata = { title: "Confidentialité" };

/** Décrit les traitements réellement faits par le code de Basile OS. Les champs TODO sont à remplir par l'éditeur. */
export default function Page() {
  return (
    <LegalPage title="Confidentialité" updated="18 novembre 2026">
      <section>
        <h2>Responsable du traitement</h2>
        <p>
          <mark>TODO nom et adresse e-mail du responsable</mark>
        </p>
      </section>
      <section>
        <h2>Données conservées</h2>
        <ul>
          <li>Le compte : adresse e-mail et mot de passe (jamais en clair, haché avec scrypt).</li>
          <li>Ce que tu saisis : tâches, projets, notes, fichiers, contacts, finances, quiz et vocabulaire.</li>
          <li>Si tu connectes Google : e-mails Gmail, événements d'Agenda et lecture des documents Drive choisis.</li>
          <li>Si tu connectes École Directe : emploi du temps, devoirs, évaluations, notes et messages.</li>
          <li>Les appareils inscrits aux notifications.</li>
        </ul>
      </section>
      <section>
        <h2>Où elles sont</h2>
        <p>Dans une base PostgreSQL chez Neon (États-Unis) et sur le Mac du propriétaire. Les clés d'accès et identifiants (Google, École Directe, IA) sont chiffrés (AES-256-GCM).</p>
      </section>
      <section>
        <h2>Avec qui elles sont partagées</h2>
        <ul>
          <li>Fournisseurs d'IA (Google Gemini, Groq) : seulement le texte nécessaire à la fonction utilisée (un cours pour un quiz, une question à l'assistant).</li>
          <li>Open-Meteo : la ville choisie, pour la météo.</li>
          <li>Aucune publicité, aucune revente, aucun outil de mesure d'audience.</li>
        </ul>
      </section>
      <section>
        <h2>Cookies</h2>
        <p>Un seul cookie, celui de la session de connexion. Le navigateur garde aussi quelques réglages d'affichage (fond d'écran, menu).</p>
      </section>
      <section>
        <h2>Durée et droits</h2>
        <p>
          Les données restent tant que le compte existe. Paramètres, puis Confidentialité, permet de tout exporter ou de supprimer le compte. Pour toute demande (accès, rectification, suppression) : <mark>TODO adresse e-mail de contact</mark>. Il est aussi possible de saisir la CNIL.
        </p>
      </section>
    </LegalPage>
  );
}
