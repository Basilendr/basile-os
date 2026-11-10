# BASILE OS

Système d'exploitation personnel augmenté par l'IA : tâches, projets, notes, Second Brain, fichiers, Google Drive, contacts, finances, analyses, automatisations, Gmail, Google Calendar, École Directe (messages, emploi du temps, devoirs, évaluations, notes), météo, assistant et agents IA — dans une seule interface.

- **Stack** : Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Motion · TanStack Query · Zod · Drizzle ORM · PostgreSQL 18 (PGlite embarqué en local, tout PostgreSQL + pgvector en production) · SDK Anthropic · TipTap · dnd-kit · Vitest.
- **Langue** : interface en français ; l'IA répond en anglais si on lui écrit en anglais.
- État détaillé, tests et limites : [PROJECT_STATUS.md](PROJECT_STATUS.md).

---

## 1. Installation locale

Prérequis : Node.js ≥ 22. Sur ce Mac, Node 24 LTS est installé localement dans `.tools/node` (aucune modification système).

```bash
export PATH="$PWD/.tools/node/bin:$PATH"   # uniquement si Node n'est pas installé globalement
npm install
cp .env.example .env.local                  # optionnel : les clés se saisissent aussi dans l'app
npm run dev                                 # http://localhost:3100
```

Au premier lancement, `/login` propose de créer le **compte propriétaire** (mot de passe Basile OS, distinct de Google). Une fois Google configuré, le bouton **Continuer avec Google** permet aussi de se connecter (seul le compte Google du propriétaire est accepté). Mot de passe oublié : serveur arrêté, lancer :

```bash
npm run account:password -- "nouveau-mot-de-passe"
```

La base est créée et migrée automatiquement au démarrage (`database/migrations`).

## 2. Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement (port 3100) |
| `npm run build` puis `npm start` | Build et serveur de production |
| `npm test` | Tests unitaires et d'intégration (PostgreSQL réel en mémoire) |
| `npm run typecheck` | Vérification TypeScript |
| `npm run db:generate -- --name <nom>` | Génère une migration après modification de `database/schema.ts` |
| `npm run account:password -- "<mdp>"` | Réinitialise le mot de passe (base embarquée, serveur arrêté) |
| `sh scripts/publish.sh` | Met le site en ligne : serveur de production + tunnel Cloudflare gratuit (adresse https://….trycloudflare.com dans `.data/public-url.txt`, nouvelle à chaque lancement ; le Mac doit rester allumé) |
| `sh scripts/preview.sh` | Seconde instance isolée (port 3101, base `.data-preview`) pour tester l'interface sans toucher aux vraies données |

### Configuration sans fichier

**Paramètres → Configuration** : coller la clé Anthropic (et, si besoin, OpenAI / Voyage) et l'ID client + secret OAuth Google. Chaque clé est **vérifiée auprès du fournisseur** avant d'être enregistrée, puis chiffrée en base ; aucun redémarrage n'est nécessaire. Une variable d'environnement définie dans `.env.local` reste prioritaire.

## 3. Configuration Google Cloud (connexion Google, Gmail, Agenda, Drive)

1. Ouvrir <https://console.cloud.google.com>, créer un projet « BASILE OS ».
2. **API et services → Bibliothèque** : activer **Gmail API**, **Google Calendar API** et **Google Drive API** (optionnel : People API).
3. **Écran de consentement OAuth** : type *Externe*, nom « BASILE OS », adresse d'assistance, puis ajouter `basileandre1002@gmail.com` dans **Utilisateurs test** (indispensable tant que l'application n'est pas vérifiée par Google).
4. Ajouter les **scopes** (minimum nécessaire) :
   - Gmail : `https://www.googleapis.com/auth/gmail.modify` (lecture, libellés, brouillons, envoi, corbeille — pas de suppression définitive)
   - Calendar : `https://www.googleapis.com/auth/calendar.events`
   - Drive : `drive.readonly` · Connexion : `openid`, `email`, `profile` · Contacts (optionnel) : `contacts.readonly`
5. **Identifiants → Créer → ID client OAuth → Application Web**, URI de redirection autorisée :
   `http://localhost:3100/api/integrations/google/callback` (en production : `https://<domaine>/api/integrations/google/callback`).
6. Coller l'ID et le secret dans **Paramètres → Configuration** (ou `.env.local` : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
7. Se déconnecter puis utiliser **Continuer avec Google** (autorise Drive, Gmail et Agenda en une fois), ou bien dans **Intégrations** cliquer **Connecter** service par service. Chaque service est autorisé indépendamment (consentement incrémental). Un service n'apparaît « Connecté » qu'après l'échange réussi du code OAuth et la vérification des scopes accordés.

Fonctionnement : OAuth 2.0 avec PKCE (S256) et `state` anti-CSRF stocké côté serveur ; jetons d'accès et de renouvellement chiffrés AES-256-GCM en base ; renouvellement automatique ; détection de l'accès révoqué (notification + statut « erreur ») ; « Déconnecter » arrête l'usage d'un service et révoque le jeton auprès de Google quand plus aucun service n'est actif.

Synchronisation : Gmail (30 derniers jours au premier passage, puis incrémentale via `history.list`), Calendar (60 jours passés → futur, puis incrémentale via `syncToken`, resynchronisation complète si le jeton expire). Automatique toutes les 5 minutes et à la demande.

## 4. Fournisseur IA

- **Anthropic (par défaut)** : créer une clé sur <https://console.anthropic.com>, la coller dans **Paramètres → Configuration** (ou `ANTHROPIC_API_KEY`). Modèle par défaut `claude-opus-5-5` (modifiable dans Paramètres → IA : Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1). Le repli serveur en cas de refus (`fallbacks: "default"`) est activé.
- **OpenAI (optionnel)** : `OPENAI_API_KEY`, puis choisir le fournisseur dans Paramètres → IA (réponses non progressives avec ce fournisseur).
- **Recherche sémantique** : `VOYAGE_API_KEY` (recommandé, `voyage-3.5`) ou `OPENAI_API_KEY` (`text-embedding-3-small`). Vecteurs stockés dans PostgreSQL (pgvector). Après configuration : Second Brain → Recherche par le sens → **Réindexer**.

Les clés ne quittent jamais le serveur. Sans clé, toutes les fonctions IA affichent clairement « IA non configurée » — aucune réponse n'est simulée. L'assistant peut insérer un graphique (bloc `chart`) construit uniquement à partir des données renvoyées par ses outils.

### École Directe

**Intégrations → École Directe** : identifiant et mot de passe École Directe (chiffrés, utilisés uniquement pour renouveler la session), puis réponse à la question de sécurité si École Directe la demande. Synchronisation toutes les 30 minutes et à la demande : messages reçus (boîte « École Directe » de la messagerie), emploi du temps (−7 j → +21 j), cahier de textes (devoirs et évaluations), notes. Cocher un devoir « fait » le répercute sur École Directe. Cours, devoirs, évaluations et notes peuvent aussi être **ajoutés à la main** (page École). L'API utilisée n'est pas officielle : `ED_API_VERSION` permet d'ajuster la version si École Directe la change.

### Météo

Données réelles Open-Meteo (sans clé). Ville par défaut déduite du fuseau horaire, modifiable dans **Paramètres → Général → Météo** (recherche ou position du navigateur).

## 5. Déploiement en production

1. PostgreSQL ≥ 15 avec l'extension **pgvector** (Supabase, Neon, RDS…) → `DATABASE_URL`.
2. `ENCRYPTION_KEY` (32 octets base64, obligatoire) : `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
3. `APP_URL=https://<domaine>` et l'URI de redirection correspondante dans Google Cloud.
4. `DATA_DIR` sur un volume persistant (fichiers importés).
5. `npm ci && npm run build && npm start` derrière un reverse-proxy HTTPS (cookies `Secure` en production). Une seule instance (ordonnanceur et limiteur de débit en mémoire).
6. Optionnel, défense en profondeur : `psql "$DATABASE_URL" -f database/rls.sql` (politiques RLS par `user_id`).

## 6. Architecture

```
app/(os)/…            pages (une par module), layout avec coque persistante
app/api/…             routes API (route() : auth, CSRF, Zod, limitation, erreurs)
components/           ui/ (système de conception), shell/, et un dossier par module
services/             logique métier (tasks, projects, notes, calendar, files, contacts, finance,
                      analytics, brain, search, dashboard, scheduler, events)
services/google/      oauth, client (retries/backoff), gmail, calendar
services/ai/          provider (Anthropic/OpenAI), tools (outils + permissions), chat (flux),
                      agents, briefing, planner, transform, embeddings, context (prompt système)
services/automations/ moteur (déclencheur → conditions → actions, idempotence, reprises) + catalogue
database/             schema.ts (Drizzle), migrations/, rls.sql
lib/                  env, db, auth, crypto, api, catalog, utils
tests/                Vitest (PostgreSQL embarqué en mémoire, API Google simulées par mock fetch)
```

Bus d'événements interne : chaque module publie (`task.completed`, `email.received`, `event.created`…), le moteur d'automatisation s'y abonne. L'IA agit via des outils typés (`creer_tache`, `rechercher_emails`, `envoyer_email`…) validés par Zod, scopés à l'utilisateur, soumis à une politique allow / confirm / deny ; l'envoi d'emails et la modification du calendrier passent **toujours** par une validation explicite.

## 7. Tests

```bash
npm test
```

29 tests d'intégration : comptes, isolation des données entre utilisateurs, tâches/projets/notes (versions, conflits), recherche, vue d'ensemble, outils IA (validation, permissions, confirmations, mémoire), planificateur, moteur d'automatisation (idempotence, échecs), OAuth Google (state, PKCE, échange, renouvellement), client Google (retry 429), MIME Gmail (injection d'en-têtes), conversion Calendar, script RLS.
