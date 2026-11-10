# PROJECT_STATUS — BASILE OS

Dernière mise à jour : 3 novembre 2026 (nuit) — connexion Google + Drive, École Directe (messagerie, emploi du temps, devoirs, évaluations, notes, saisie manuelle), météo réelle, configuration de l'IA et de Google dans l'application, refonte façon « Aniq » (panneaux flottants, vue d'ensemble avec tendances, assistant avec orbe et graphiques).

### Messagerie classique et Gemini (3 novembre, soir)
| Élément | État | Vérification |
| --- | --- | --- |
| Troisième boîte « Autre adresse » : n'importe quelle adresse IMAP/SMTP (Orange, Free, SFR, La Poste, iCloud, Yahoo, Outlook, réglages manuels), lecture des 60 derniers messages, contenu chargé à l'ouverture dans un cadre isolé, réponse et nouveau message avec confirmation avant envoi, synchro toutes les 10 min | ✅ UI · 🟡 serveur réel | tests (validation, serveur injoignable → rien n'est enregistré) ; **non testé avec une vraie boîte** |
| Fournisseur IA **Google Gemini** (offre gratuite d'AI Studio) via son point d'accès compatible : assistant, outils, sorties JSON ; clé vérifiée puis activée automatiquement si aucune autre IA n'est configurée ; message clair quand le quota gratuit est atteint | ✅ code · 🟡 réel | 2 tests (appel, outils, quota, JSON) ; **non testé avec une vraie clé** |

### Refonte de l'interface (3 novembre, soir)
| Élément | État | Vérification |
| --- | --- | --- |
| **Navigation en dossiers** : 3 accès directs (Accueil, Assistant IA, Messagerie) + 4 dossiers colorés (Organisation, École, Documents, Personnel) qui s'ouvrent sur des tuiles, un seul ouvert à la fois ; barre réduite en rail avec dossier en panneau flottant ; mobile : barre d'onglets + « Dossiers » | ✅ | navigateur 1440, 1280, 1024, 375 px |
| **Accueil sur un seul écran** (dès 1280 × 800) : ciel qui suit l'heure réelle (aube, jour, crépuscule, nuit) et la météo réelle (nuages, pluie, étoiles), indicateurs avec tendance, aperçu à anneaux, 3 emplacements de widgets au choix (« Personnaliser ») qui défilent à l'intérieur | ✅ | navigateur : aucune barre de défilement à 1440 × 900 et 1280 × 800 |
| **Assistant** fidèle à la vidéo Aniq : anneau lumineux, « Ravi de te revoir », barre de saisie centrale, onglets Discussion / Centre de commande / Agents, historique dans un panneau latéral, bulles de messages | ✅ UI · 🟡 IA | navigateur clair + sombre |
| Barre supérieure et barre latérale en panneaux flottants, fil d'Ariane « Dossier › Page », emploi du temps qui s'adapte à la hauteur de l'écran | ✅ | navigateur |

### Nouveautés (3 novembre, nuit)
| Fonctionnalité | État | Vérification |
| --- | --- | --- |
| **Configuration dans l'app** (Paramètres → Configuration) : clés Anthropic / OpenAI / Voyage et identifiants OAuth Google collés dans l'interface, **vérifiés auprès du fournisseur** avant enregistrement, chiffrés en base (AES-256-GCM), jamais renvoyés au navigateur ; les variables d'environnement restent prioritaires | ✅ | navigateur : une clé invalide est refusée par l'API Anthropic ; tests |
| **« Continuer avec Google »** sur la page de connexion (OAuth PKCE, un seul compte Google autorisé = propriétaire, création du compte au premier passage) | 🟡 | code + flux simulé ; bouton désactivé tant que l'ID client n'est pas configuré ; **non testé contre Google réel** |
| **Google Drive** dans Fichiers : Mon Drive / Récents / Partagés / Suivis, dossiers et fil d'Ariane, recherche plein texte, aperçu (Docs/Sheets/Slides convertis en PDF), téléchargement, import dans Mes fichiers ; le jeton Google ne quitte jamais le serveur | 🟡 | navigateur (état « non connecté ») ; **non testé contre Drive réel** |
| **École Directe** : connexion (identifiants chiffrés, question de sécurité / double authentification), synchro toutes les 30 min + manuelle, reconnexion automatique, notifications des nouveaux messages et notes | 🟡 | 6 tests avec un faux serveur École Directe ; **API non officielle, non testée avec un vrai compte** |
| Messagerie à **deux boîtes** : Gmail et École Directe (liste, lecture dans un cadre isolé, pièces jointes listées) | ✅ UI · 🟡 données | navigateur (états vides) |
| Page **École** : emploi du temps semaine (heure courante, cours annulés, détail), **devoirs** (à faire / faits, répercuté sur École Directe), **évaluations à venir**, **notes** et moyennes par matière ; **ajout manuel** de cours (répétables), devoirs, évaluations et notes | ✅ | navigateur : cours, devoir (coché fait), note ajoutés et affichés |
| **Météo réelle** (Open-Meteo, sans clé) : actuelle + 5 jours dans l'accueil, choix de la ville (recherche ou position) | ✅ | navigateur : Paris par défaut puis Lyon choisi |
| Vue d'ensemble : période 7/30/90 j, **tendances réelles vs période précédente**, mini-courbes, anneaux concentriques Performance / Tendances, widget Activité, widget École, **export CSV** | ✅ | navigateur + test |
| Assistant : orbe animé (figé si animations réduites), sélecteur de modèle, **graphiques dans les réponses** (bloc `chart` validé strictement), outil `consulter_ecole` | ✅ UI · 🟡 IA | navigateur |
| Coque : barre latérale flottante à groupes dépliables (Messagerie, Fichiers, École), bouton menu pour la réduire, thème sombre fidèle à la vidéo | ✅ | navigateur clair + sombre |

### Correctif connexion (3 novembre)
- Cause : le compte avait été créé pendant les tests avec un mot de passe généré, inconnu de l'utilisateur (échec 401 constaté dans les journaux).
- Correction : données de test supprimées ; `/login` affiche de nouveau la création du compte propriétaire. Aide « mot de passe oublié » ajoutée sur la page de connexion (`npm run account:password`).

Légende : ✅ terminé et vérifié · 🟡 terminé, vérifié partiellement (dépend d'un service externe non configuré) · ⛔ bloqué / non implémenté

---

## 1. Ce qui est terminé

### Phase 1 — Fondations
| Fonctionnalité | État | Vérification |
| --- | --- | --- |
| Architecture Next.js 16 / TypeScript / Drizzle / PostgreSQL (PGlite local, PostgreSQL + pgvector en prod) | ✅ | build de production OK |
| Schéma relationnel complet (39 tables, clés étrangères, index, contraintes, isolation `user_id`) + migrations versionnées | ✅ | tests d'intégration |
| Politiques RLS (`database/rls.sql`) | ✅ | appliquées sur la base de test |
| Authentification propriétaire (scrypt, sessions hachées en base, cookie httpOnly/SameSite), changement de mot de passe, sessions actives, révocation | ✅ | navigateur + curl |
| Protection CSRF (origine), limitation de débit, validation Zod centralisée, erreurs JSON uniformes, journalisation structurée avec masquage des secrets, en-têtes de sécurité | ✅ | curl (origine étrangère → 403, sans session → 401) |
| Système de conception sobre (thème clair par défaut, sombre en option, police système Apple, jetons, composants : boutons, champs, modales, menus, feuilles, toasts, états vides/chargement/erreur, fil d'Ariane) | ✅ | navigateur |
| Barre latérale réductible mémorisée, barre supérieure (recherche, ⌘K, assistant, notifications, date/heure, profil), navigation mobile (tiroir + barre d'onglets), raccourcis clavier (⌘K, ⌘J, G+lettre, C) | ✅ | navigateur bureau + mobile 375 px |
| Vue d'ensemble : accueil avec horloge, indicateurs, aperçu (anneau de progression), tâches du jour, mini-calendrier, planning, briefing, échéances, projets, fil d'activité, actions rapides ; widgets déplaçables, redimensionnables, masquables, enregistrés | ✅ | navigateur |
| Paramètres : général, apparence (thème, accent, densité), IA, confidentialité (export JSON, suppression du compte), sécurité (sessions, jetons, historique des accès) | ✅ | navigateur |

### Phase 2 — Productivité
| Fonctionnalité | État | Vérification |
| --- | --- | --- |
| Tâches : vues Ma journée / À venir / Toutes / En retard / Terminées / Par projet, Kanban glisser-déposer, détail complet (sous-tâches, pièces jointes, rappels, catégories), saisie rapide en langage naturel (« demain 10h !haute ») | ✅ | navigateur + tests |
| Projets : grille / liste / Kanban / chronologie, tableau de bord (avancement, progression 12 semaines), étapes, notes, documents, réunions, historique, modification/suppression | ✅ | navigateur + tests |
| Notes : éditeur riche (titres, listes, checklists, tableaux, images, liens, code), dossiers, étiquettes, favoris, recherche, autosauvegarde avec détection de conflit et brouillon local de secours, historique des versions + restauration | ✅ | navigateur + tests |
| Fil d'activité, centre de notifications (filtres, lu/non lu, suppression, préférences), palette de commandes | ✅ | navigateur |
| Rappels, échéances, événements imminents → notifications (ordonnanceur interne) | ✅ | code + idempotence testée |

### Phase 3 — Écosystème Google
| Fonctionnalité | État | Vérification |
| --- | --- | --- |
| OAuth 2.0 Google (PKCE, state, consentement incrémental par service, chiffrement AES-256-GCM, renouvellement, révocation, reconnexion, gestion `invalid_grant`) | 🟡 | tests avec API Google simulée ; **non testé contre Google réel** (identifiants absents) |
| Gmail : liste par dossiers, recherche native + filtres avancés, lecture (fil, HTML isolé en iframe sandbox, images distantes bloquées), pièces jointes, répondre / répondre à tous / transférer, archiver, corbeille (confirmée), lu/non lu, étoile, important, spam, libellés, synchro complète + incrémentale | 🟡 | code + tests unitaires ; **non testé contre Gmail réel** |
| Éditeur d'email : À/Cc/Cci, mise en forme, pièces jointes, brouillon Gmail auto-enregistré, envoi avec confirmation, considéré envoyé seulement après réponse de l'API | 🟡 | idem |
| Calendrier : vues jour / semaine / mois / agenda, création / modification / suppression, couleurs, récurrence, rappels, participants, fuseau, glisser-déposer (pas de 15 min), préparation de rendez-vous (contacts, emails, documents, notes) | ✅ en local · 🟡 Google | glisser-déposer vérifié dans le navigateur ; Google Calendar non testé réellement |
| Centre d'intégrations (statut réel, dernière synchro, scopes, erreurs, connecter/déconnecter/reconnecter, guide de configuration) | ✅ | navigateur |

### Phase 4 — Intelligence artificielle
| Fonctionnalité | État | Vérification |
| --- | --- | --- |
| Couche fournisseur (Anthropic streaming + outils, OpenAI), sorties structurées, repli serveur en cas de refus | 🟡 | **aucune clé API disponible : jamais appelé réellement** |
| 24 outils structurés (Zod, scope utilisateur, politique allow/confirm/deny, journalisation, sortie JSON, contenus externes balisés « non fiables ») | ✅ | tests (validation, permissions, confirmations, mémoire, isolation) |
| Actions en attente de validation (modification possible, verrou anti double exécution) | ✅ | tests |
| Assistant (historique, recherche, renommage, suppression, flux progressif, Markdown, pièces jointes, suggestions contextuelles), panneau global ⌘J | 🟡 | UI vérifiée ; message « IA non configurée » vérifié |
| Centre de commande (étapes affichées, actions proposées, confirmations, historique) | 🟡 | idem |
| Briefing quotidien / bilan du soir avec sources | 🟡 | idem |
| Planificateur quotidien (créneaux libres réels, validation serveur, accepter/modifier/refuser/régénérer/enregistrer, création d'événements confirmée) | ✅ | fonctionne **sans IA** (algorithme déterministe) — testé ; mode IA non testé |
| Assistant email (résumer, expliquer, réponse, améliorer, traduire, tâches, dates, infos clés), boîte intelligente avec explication | 🟡 | code ; non testé faute de clé |

### Phase 5 — Agents
| Agents Email, Calendrier, Productivité, Projets, Recherche, Personnel (délégation) ; permissions limitées par défaut, configuration, activation, historique des exécutions | 🟡 | UI + permissions testées ; exécution non testée faute de clé |

### Phase 6 — Second Brain
| Fonctionnalité | État | Vérification |
| --- | --- | --- |
| Connaissances (idées, comptes rendus, références, emails importants), relations entre tous les types d'éléments | ✅ | navigateur |
| Graphe de connaissances interactif (forces, zoom, filtres, clic = source) | ✅ | navigateur |
| Recherche sémantique (embeddings Voyage/OpenAI + pgvector, segmentation, réindexation incrémentale) | 🟡 | pgvector vérifié ; **aucune clé d'embeddings** → repli explicite sur la recherche par mots-clés |
| Mémoire IA contrôlée (activation, catégories autorisées, ajout/modification/suppression, sources, refus des informations sensibles, validation avant mémorisation) | ✅ | tests + navigateur |
| Analyse documentaire (extraction PDF/DOCX/texte, résumé, questions, note structurée) | ✅ extraction · 🟡 IA | import + recherche dans le contenu vérifiés |

### Phase 7 — Modules avancés
| Fichiers (import multiple, glisser-déposer, dossiers, renommer, déplacer, supprimer, favoris, tri, filtres, recherche dans le contenu, prévisualisation image/PDF/texte, téléchargement, liaison projet, types refusés) | ✅ | navigateur + curl |
| Contacts (champs complets, étiquettes, favoris, recherche, projets associés, historique réel emails/rendez-vous) | ✅ | navigateur |
| Finances (revenus, dépenses, catégories, budgets, objectifs d'épargne, rapport mensuel, graphique 12 mois) — saisie manuelle uniquement | ✅ | navigateur |
| Analyses (7 j / 30 j / 90 j / 12 mois, productivité, projets, temps planifié, emails, habitudes, observations factuelles chiffrées) | ✅ | navigateur |
| Moteur d'automatisation (10 déclencheurs, conditions, 9 actions, constructeur visuel à nœuds déplaçables, prévisualisation, test, historique, idempotence, 3 tentatives avec délai, actions externes → validation) | ✅ | tests + navigateur |
| Recherche universelle (9 sources, insensible aux accents, recherches récentes, filtres, palette, page de résultats, interprétation IA) | ✅ | navigateur |

## 2. En cours / bloqué

| Élément | Statut | Ce qu'il faut |
| --- | --- | --- |
| Connexion Google (Gmail, Agenda, Drive, « Continuer avec Google ») | ⛔ bloqué par la configuration | Créer l'ID client OAuth (README §3) puis le coller dans Paramètres → Configuration |
| Toutes les fonctions IA (assistant, agents, briefing, transformations, classification) | ⛔ bloqué par la configuration | Coller une clé Anthropic dans Paramètres → Configuration (je ne peux pas créer de compte ni de clé à ta place) |
| Recherche sémantique | ⛔ bloqué par la configuration | Clé Voyage ou OpenAI dans Paramètres → Configuration, puis « Réindexer » |
| École Directe réel | 🟡 à valider | Saisir tes identifiants dans Intégrations ; l'API n'est pas officielle et peut changer |
| Import Google Contacts | ⛔ non implémenté | L'autorisation OAuth existe ; la synchronisation reste à développer |

## 3. Tests exécutés

- `npm test` : **40/40 réussis** (dont messagerie IMAP et Gemini) (6 fichiers : productivité, IA, automatisations, Google, École Directe, vue d'ensemble).
- `npm run typecheck` : aucune erreur. `next build` : réussi (toutes les pages et routes API compilées).
- Navigateur intégré (3 nov., nuit) : vue d'ensemble clair/sombre avec météo réelle, page École (ajout cours / devoir / note, case « fait »), messagerie École Directe, Intégrations (carte École Directe), Configuration (clé invalide refusée), choix de ville météo, Drive (non connecté), assistant (orbe, sélecteur de modèle). Écarts d'hydratation corrigés.
- Navigateur intégré (précédemment) : chaque page chargée (200), parcours vérifiés — création du compte, connexion, création de tâche (dialogue et saisie naturelle), détail de tâche, projet et tableau de bord, note (autosauvegarde + recherche), planificateur, déplacement d'événement par glisser-déposer, Second Brain (graphe), constructeur d'automatisation + exécution test, intégrations, paramètres, vue mobile 375 px.
- Sécurité (curl) : origine étrangère refusée (403), API sans session (401), redirection des pages vers /login, en-têtes `nosniff`, `SAMEORIGIN`, CSP `frame-ancestors`, types de fichiers exécutables refusés.

## 4. Problèmes connus et limites

- Les intégrations Google, École Directe et le fournisseur IA n'ont été testés qu'avec des réponses simulées : un premier essai réel peut révéler des ajustements.
- École Directe : API non officielle (documentée par la communauté). Les pièces jointes des messages sont listées mais s'ouvrent sur École Directe. Un compte famille cible le premier enfant.
- La langue de l'interface est le français uniquement (la langue des réponses de l'IA se règle dans Paramètres → Général).
- Tests de bout en bout automatisés (Playwright) non mis en place : vérifications faites manuellement dans le navigateur.
- PGlite (base embarquée) n'accepte qu'un processus : arrêter le serveur avant `npm run account:password`. En production, utiliser `DATABASE_URL`.
- Ordonnanceur et limiteur de débit en mémoire : une seule instance serveur.
- Notifications internes à l'application uniquement (pas de push mobile ni d'email).
- Avec OpenAI, les réponses arrivent en une fois (pas de flux progressif).
- Événements Google récurrents : les occurrences sont synchronisées individuellement ; modifier une occurrence ne modifie pas la série.
- Pas d'authentification à deux facteurs.
- Les politiques RLS sont fournies mais l'application se connecte avec le rôle propriétaire : l'isolation effective repose sur le filtre `user_id` applicatif (testé).

## 5. Prochaines étapes

1. Coller la clé Anthropic dans Paramètres → Configuration et valider l'assistant, les agents et le briefing sur des données réelles.
2. Configurer OAuth Google, se connecter avec Google et tester Gmail / Agenda / Drive avec le compte réel.
3. Connecter École Directe avec le vrai compte et vérifier la synchronisation (messages, emploi du temps, devoirs, notes).
4. Ajouter une clé d'embeddings et réindexer le Second Brain ; implémenter l'import Google Contacts.
5. Ajouter des tests de bout en bout Playwright et une authentification à deux facteurs.
