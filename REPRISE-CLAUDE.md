# BASILE OS — dossier de reprise pour Claude

> À l'attention de Claude (nouveau compte) : ce fichier accompagne l'archive `basile-os.zip`. Il résume le projet, ce qui a été fait, où on en est, et comment le reprendre. L'utilisateur s'appelle Basile. Il écrit en français.

## 0. Comment travailler avec Basile (important)

- **Langue :** réponds toujours en français.
- **Aucun message intermédiaire :** n'écris jamais de texte entre deux appels d'outils, même une ligne du type « bug corrigé, je passe à X ». Basile l'a demandé plusieurs fois, fermement.
- **Message final court :** quelques lignes au maximum. Quand il le demande, juste « c'est bon ».
- **Ne demande pas ce que tu peux trouver toi-même :** décide et avance.
- **Mots de passe et clés :** ne saisis jamais toi-même un mot de passe, une clé API ou un secret dans un champ. Basile les colle lui-même.
- **Accords explicites :** demande son accord avant d'accepter des conditions d'utilisation ou d'installer un démarrage automatique sur le Mac.

## 1. Le projet

**BASILE OS** est un « système d'exploitation personnel » en web app, en français :
- accueil sur un seul écran, avec ciel animé et météo réelle ;
- tâches, projets, calendrier, notes, fichiers, contacts, finances ;
- assistant IA avec agents et automatisations ;
- messagerie Gmail, École Directe et « Autre adresse » (IMAP/SMTP, dont iCloud) ;
- page École (emploi du temps, devoirs, notes, évaluations) ;
- Google Drive.

### Stack technique

- **Framework :** Next.js 16 (App Router, dossier `app/`, garde de navigation dans `proxy.ts`). Lire `AGENTS.md` : cette version de Next diffère de ce que tu connais, et la doc est dans `node_modules/next/dist/docs/`.
- **Langage :** TypeScript, React 19, Tailwind 4, TanStack Query.
- **Base de données :** Drizzle ORM, schéma dans `database/schema.ts`, migrations dans `database/migrations` (appliquées automatiquement au démarrage).
  - en local : PGlite (PostgreSQL embarqué) dans `.data/pg` ;
  - si `DATABASE_URL` est défini : vrai PostgreSQL (Neon, Supabase…).
- **Secrets :** les secrets saisis dans l'app (clés IA, OAuth Google, identifiants École Directe et mail) sont chiffrés en AES-256-GCM dans la table `instance_secrets` et les tables d'intégration.
  - La clé de chiffrement vient de `ENCRYPTION_KEY`, sinon de `.data/encryption.key`, créée automatiquement en local.
- **Mail :** imapflow, nodemailer, mailparser.
- **IA :** Gemini est le fournisseur actif (offre gratuite AI Studio), via le point d'accès compatible OpenAI.
  - Si Gemini renvoie 503 ou 429, l'app réessaie avec `gemini-flash-lite-latest`.
  - Anthropic et OpenAI restent possibles. La clé Claude a été retirée à la demande de Basile.
- **Tâches de fond :** `services/scheduler.ts` gère rappels, échéances, synchro Gmail/Calendar (5 min), mail IMAP (10 min) et École Directe (30 min).
- **Tests :** `npm test`, avec Vitest et une base PGlite en mémoire (43 tests, tous verts).

### Arborescence utile

| Dossier | Contenu |
| --- | --- |
| `app/(os)/…` | pages de l'app |
| `app/api/…` | routes API (toutes passent par `route()` de `lib/api.ts` : session, CSRF, Zod, limitation de débit) |
| `components/…` | interface |
| `services/…` | logique métier (`mail/mail.ts`, `school/ecoledirecte.ts`, `ai/provider.ts`, `files.ts`, `scheduler.ts`…) |
| `lib/` | `db.ts`, `env.ts`, `crypto.ts`, `secrets.ts`, `errors.ts`, `nav.ts`… |
| `scripts/` | scripts de lancement et de mise en ligne (voir § 4) |
| `PROJECT_STATUS.md` | état détaillé fonctionnalité par fonctionnalité |
| `README.md` | commandes |

## 2. Ce qui a été fait dans la session précédente (résumé)

1. **Refonte de l'interface façon « Aniq » :**
   - accueil sur un seul écran ;
   - barre latérale avec 3 raccourcis (Accueil, Assistant, Messagerie) et 4 dossiers colorés (Organisation, École, Documents, Personnel) qui s'ouvrent sur des tuiles ;
   - assistant avec anneau lumineux.
2. **Messagerie « Autre adresse » (IMAP/SMTP) :**
   - spécificités iCloud : identifiant = adresse e-mail complète, mot de passe *spécifique à l'app* généré sur account.apple.com, espaces retirés ;
   - messages d'erreur clairs ;
   - plusieurs identifiants essayés.
3. **Fournisseur Gemini (gratuit) :** il remplace Claude, avec un modèle de secours en cas de surcharge.
4. **Google OAuth :** client OAuth créé dans Google Cloud. « Continuer avec Google » et Drive fonctionnent en local (`http://localhost:3100`).
5. **École Directe :** nouveau protocole de connexion :
   - cookie GTK, en-têtes `X-Token` et `2FA-Token`, `cn`/`cv` au premier niveau, version d'API 4.101.4 ;
   - un refus d'identifiants renvoie l'erreur `invalid_credentials` (HTTP 422) au lieu de 401, sinon le client déconnectait Basile.
6. **Publication temporaire** via un tunnel Cloudflare (`scripts/publish.sh`) :
   - adresse `https://….trycloudflare.com`, qui change à chaque redémarrage ;
   - ne fonctionne que si le Mac est allumé.
7. **Préparation à l'hébergement permanent sur Vercel + Neon** (fait, testé, pas encore déployé) :
   - `services/files.ts` : sur Vercel (`VERCEL` défini) ou avec `FILE_STORAGE=db`, le contenu des fichiers est stocké en base (table `file_blobs`), et l'import est limité à 4 Mo (limite Vercel).
   - `services/scheduler.ts` : sur Vercel, pas de minuterie permanente. `runDueJobs()` lance les tâches dues.
     - Il est appelé après chaque requête `/api/status`, que l'interface interroge toutes les 60 s, et par la tâche cron `/api/cron`, protégée par `CRON_SECRET`, une fois par jour (`vercel.json`).
     - La table `job_runs` empêche les doublons entre instances.
   - `lib/db.ts` : pool de connexions réduit sur Vercel.
   - Migration `0005_hosting.sql`, tests `tests/hosting.test.ts`, fichiers `vercel.json` (région Paris `cdg1`) et `.vercelignore`.
   - `scripts/copy-to-postgres.mjs` copie la base locale PGlite vers la base Neon. Il refuse si la cible contient déjà un compte. **Il n'a pas encore été exécuté contre un vrai Postgres.**
8. **Démarrage automatique sur le Mac** (`scripts/install-service.sh`, launchd) : écrit mais **pas installé**. Il faut l'accord explicite de Basile. Devenu inutile si Vercel fonctionne.

9. **Quiz de révision** (page `/quiz`, dossier École) — ajouté le 10 novembre 2026, sur le site local uniquement (pas déployé sur Vercel) :
   - `services/quiz/` : `time.ts` (créneaux : 18 h en semaine, 14 h le mercredi, 10 h le week-end, réglables), `sources.ts` (lecture des cours dans Drive, cache `quiz_documents`), `generate.ts` (rédaction par l'IA, questions réparties entre tous les documents), `core.ts` (correction, répétition espacée), `quiz.ts` (quiz, tentatives, tableau de bord), `schedule.ts` (tâche `quiz-schedule` toutes les 5 min).
   - Quiz du soir sur les documents Drive modifiés dans la journée, bilan le week-end, rattrapage du quiz de la veille, et pour chaque évaluation dont les documents sont choisis (`school_homework.quiz_sources`) un quiz 7 jours avant, 3 jours avant et la veille.
   - Écran : `components/quiz/` (`quiz-view.tsx`, `quiz-player.tsx`, `drive-picker.tsx`), routes `app/api/quiz/**`, migration `0006_quiz.sql`, tests `tests/quiz.test.ts`.
   - Depuis le 10 novembre : **un quiz du soir par matière** (clé `daily:<date>:<matière>`). La matière vient du dossier Drive (sous-dossiers d'un dossier qui en regroupe au moins trois, ex. `Etudes/HGGSP`), sinon du nom du fichier, sinon de l'IA (mémorisée dans `quiz_documents.subject`). La longueur suit le cours (`questionRange` : environ une question pour 200 caractères, 8 à 25 le soir) et l'IA dresse d'abord la liste de toutes les notions (`notions`) pour en interroger chacune.
   - **Minuteur Pomodoro** : onglet École → Pomodoro (`/school?tab=focus`), `components/school/pomodoro.tsx` (minuteur global monté dans `Shell`, pastille dans la barre du haut, état dans `localStorage`), séances enregistrées dans `study_sessions` (`services/school/focus.ts`, routes `app/api/school/focus`), migration `0007_focus.sql`, tests `tests/focus.test.ts`.
   - **Agent emploi du temps** (10 nov.) : `services/school/agent.ts` lit les messages École Directe de M. Casaux (et ceux dont l'objet parle d'emploi du temps), télécharge le PDF joint (`downloadAttachment`), compare avec École Directe et enregistre les différences dans `school_changes` ; `services/school/overlay.ts` les applique à l'affichage (annulé, modifié, ajouté, fermeture). Fériés calculés et vacances (zone C, data.education.gouv.fr) dans `services/school/days.ts`. Tout s'enchaîne après chaque synchro ED (`services/school/pipeline.ts`). Agenda Google : `services/school/gcal.ts` (agenda principal, événements marqués `basileos=school` et ignorés à l'import ; agenda « École » séparé si la permission `calendar.app.created` est accordée). Migration `0008_timetable_agent.sql`, tests `tests/timetable.test.ts`.
   - **Emploi du temps reçu = référence** (10 nov.) : le PDF de la semaine est recopié en entier (`school_changes` action `lesson` + `week` par jour couvert) et remplace École Directe ces jours-là (intitulés ED souvent faux : « SVT » pour HGGSP), calé sur les horaires exacts d'ED (`matchDay`). Les semaines sans PDF sont corrigées par la semaine type apprise (`learnTemplate`). Repas, pastorale et sorties ne sont pas des cours (`NOT_A_CLASS`). Les heures ED sont lues en heure de Paris (`edDate`), sinon décalage d'1 h sur Vercel.
   - Les appels IA de fond ont un délai de 90 s puis un repli sur Flash-Lite (`services/ai/provider.ts`) : sans cela, une requête Gemini restée sans réponse bloquait le quiz « en préparation ».

## 3. Où on en est / prochaine étape : mise en ligne permanente sur Vercel

Basile a déjà un compte Vercel. Il n'a pas encore de compte Neon : le plus simple est de le créer depuis Vercel.

1. **Connexion Vercel :** `npx vercel login` (dans le dossier du projet). Basile valide le code dans son navigateur.
2. **Créer le projet :** `npx vercel link --yes` (ou un premier `npx vercel deploy`).
3. **Créer la base :** Basile ouvre le projet sur vercel.com → **Storage** → **Create Database** → **Neon** (gratuit), puis le relie au projet. Vercel ajoute alors `DATABASE_URL` automatiquement. Basile accepte lui-même les conditions.
4. **Variables d'environnement** (onglet Settings → Environment Variables, ou `vercel env add`) :
   - `ENCRYPTION_KEY` : **la même clé que `.data/encryption.key` du Mac**, sinon les secrets copiés seront illisibles ;
   - `APP_URL` : l'adresse Vercel finale, par ex. `https://basile-os.vercel.app` ;
   - `CRON_SECRET` : une longue valeur aléatoire.
5. **Copier les données du Mac vers Neon :** `vercel env pull .env.neon`, puis `DATABASE_URL=… node scripts/copy-to-postgres.mjs`. C'est à faire sur le Mac, où se trouve `.data/pg`.
6. **Déployer :** `npx vercel deploy --prod`, puis tester la connexion, l'accueil, l'assistant et la messagerie.
7. **Google :** ajouter `https://<adresse-vercel>/api/integrations/google/callback` aux URI de redirection autorisées du client OAuth, dans Google Cloud Console → Identifiants. Sinon « Continuer avec Google » et Drive ne marcheront pas en ligne.

**Sans base locale :** si Basile repart sans les données du Mac, saute l'étape 5. Il recréera son compte à la première ouverture, puis recollera ses clés (Gemini, Google, École Directe, mail) dans Paramètres → Configuration et Intégrations.

**Limite du plan gratuit Vercel :** le cron ne tourne qu'une fois par jour. Les synchros se font surtout quand le site est ouvert. Pour plus de régularité, un service gratuit comme cron-job.org peut appeler `/api/cron` toutes les 5 à 10 min, avec l'en-tête `Authorization: Bearer <CRON_SECRET>`.

## 4. Commandes

| Action | Commande |
| --- | --- |
| Installer les dépendances | `npm install` (Node 22 ou plus) |
| Développement | `npm run dev` → http://localhost:3100 |
| Tests | `npm test` · types : `npm run typecheck` |
| Build / production locale | `npm run build` puis `sh scripts/start.sh` |
| Tunnel public temporaire | `sh scripts/publish.sh` (nécessite `.tools/cloudflared/cloudflared`) |
| Mot de passe oublié | `npm run account:password` |
| Copie de la base locale vers Postgres | `DATABASE_URL=… node scripts/copy-to-postgres.mjs` |

Sur le Mac d'origine, Node est dans `.tools/node/bin`. Ce dossier n'est pas dans l'archive : installe Node 22 ou plus si besoin.

## 5. Ce que l'archive ne contient PAS (volontairement)

- **`.data/`** : base locale, clé de chiffrement, journaux. Elle contient des données personnelles et des secrets chiffrés. Elle reste sur le Mac de Basile, et `scripts/copy-to-postgres.mjs` en a besoin.
- **`.env.local`** : la configuration locale (seulement `APP_URL`).
- **`node_modules/`, `.next/`, `.tools/`** : se régénèrent avec `npm install` / `npm run build`.

Aucune clé API ni aucun mot de passe ne figure dans ce dossier.

- **10 nov. (suite)** :
  - Emploi du temps : l'onglet affiche tel quel le PDF de M. Casaux pour la semaine (`services/school/documents.ts`, table `school_documents` qui garde le fichier, route `/api/school/timetable/document?file=`). Bouton « Grille » pour l'ancienne vue.
  - IA : Groq et Mistral ajoutés (`GROQ_API_KEY`, `MISTRAL_API_KEY`). Choix automatique par fonction dans `services/ai/provider.ts` (`TASK_ROUTES`, `routeFor`, `routed`) : assistant, textes courts, quiz, lecture de PDF ; passage à l'IA suivante si quota, surcharge ou lenteur. Tableau explicatif dans Paramètres → Configuration.
  - Écran « Aujourd'hui » sur `/` (`components/today/today-view.tsx`, `/api/today`, `services/today.ts`) ; l'ancienne vue d'ensemble est sur `/overview`.
  - Graphique d'évolution des notes et alerte « en baisse » (`components/school/grade-trend.tsx`) dans École → Évaluations.
  - Instance d'aperçu isolée : `DATABASE_URL= DATABASE_URL_UNPOOLED= sh scripts/preview.sh` (port 3101, base embarquée), compte créé via `/api/auth/setup`.
