/**
 * Catalogues partagés client/serveur (aucun secret) :
 * outils IA, agents, widgets du tableau de bord, libellés métier.
 */

export type ToolSensitivity = "read" | "write" | "external";

export const TOOLS = {
  rechercher_emails: { label: "Rechercher des emails", sensitivity: "read", service: "gmail" },
  lire_email: { label: "Lire un email", sensitivity: "read", service: "gmail" },
  resumer_email: { label: "Résumer un email", sensitivity: "read", service: "gmail" },
  creer_brouillon_email: { label: "Créer un brouillon Gmail", sensitivity: "write", service: "gmail" },
  envoyer_email: { label: "Envoyer un email", sensitivity: "external", service: "gmail" },
  rechercher_calendrier: { label: "Consulter le calendrier", sensitivity: "read", service: "calendar" },
  trouver_creneaux: { label: "Trouver des créneaux libres", sensitivity: "read", service: "calendar" },
  creer_evenement: { label: "Créer un événement", sensitivity: "external", service: "calendar" },
  modifier_evenement: { label: "Modifier un événement", sensitivity: "external", service: "calendar" },
  creer_tache: { label: "Créer une tâche", sensitivity: "write" },
  modifier_tache: { label: "Modifier une tâche", sensitivity: "write" },
  rechercher_taches: { label: "Rechercher des tâches", sensitivity: "read" },
  creer_projet: { label: "Créer un projet", sensitivity: "write" },
  rechercher_projets: { label: "Rechercher des projets", sensitivity: "read" },
  creer_note: { label: "Créer une note", sensitivity: "write" },
  rechercher_notes: { label: "Rechercher des notes", sensitivity: "read" },
  rechercher_fichiers: { label: "Rechercher des fichiers", sensitivity: "read" },
  resumer_document: { label: "Lire un document", sensitivity: "read" },
  recherche_semantique: { label: "Recherche sémantique", sensitivity: "read" },
  creer_rappel: { label: "Créer un rappel", sensitivity: "write" },
  generer_briefing_quotidien: { label: "Préparer le briefing", sensitivity: "read" },
  consulter_memoire: { label: "Consulter la mémoire", sensitivity: "read" },
  enregistrer_memoire: { label: "Enregistrer en mémoire", sensitivity: "write" },
  deleguer_agent: { label: "Déléguer à un agent", sensitivity: "read" },
  consulter_ecole: { label: "Consulter l'école (cours, devoirs, notes)", sensitivity: "read" },
} as const satisfies Record<string, { label: string; sensitivity: ToolSensitivity; service?: string }>;

export type ToolName = keyof typeof TOOLS;

/** Politique par défaut : lecture libre, écriture locale libre, actions externes toujours confirmées. */
export function defaultToolPolicy(tool: ToolName): "allow" | "confirm" | "deny" {
  const s = TOOLS[tool].sensitivity;
  if (s === "external") return "confirm";
  if (tool === "enregistrer_memoire") return "confirm";
  return "allow";
}

/** Outils dont la confirmation explicite ne peut jamais être désactivée. */
export const ALWAYS_CONFIRM: ToolName[] = ["envoyer_email", "creer_evenement", "modifier_evenement"];

export const AGENTS = {
  personal: {
    name: "Agent Personnel",
    icon: "sparkles",
    description: "Coordonne les autres agents et assemble des briefings complets.",
    defaultPermissions: ["deleguer_agent", "consulter_memoire", "generer_briefing_quotidien", "rechercher_taches", "rechercher_calendrier", "consulter_ecole"],
  },
  email: {
    name: "Agent Email",
    icon: "mail",
    description: "Analyse la boîte de réception, repère l'important et prépare des réponses.",
    defaultPermissions: ["rechercher_emails", "lire_email", "resumer_email", "creer_brouillon_email", "creer_tache"],
  },
  calendar: {
    name: "Agent Calendrier",
    icon: "calendar",
    description: "Analyse le planning, détecte les conflits et trouve des disponibilités.",
    defaultPermissions: ["rechercher_calendrier", "trouver_creneaux", "creer_evenement", "modifier_evenement"],
  },
  productivity: {
    name: "Agent Productivité",
    icon: "check-circle",
    description: "Organise les tâches, repère les retards et propose des plans quotidiens.",
    defaultPermissions: ["rechercher_taches", "creer_tache", "modifier_tache", "rechercher_projets", "rechercher_calendrier", "trouver_creneaux", "consulter_ecole"],
  },
  projects: {
    name: "Agent Projets",
    icon: "folder-kanban",
    description: "Surveille l'avancement, détecte les blocages et propose les prochaines actions.",
    defaultPermissions: ["rechercher_projets", "rechercher_taches", "creer_tache", "rechercher_notes"],
  },
  research: {
    name: "Agent Recherche",
    icon: "search",
    description: "Retrouve et relie l'information dans les notes, documents et emails, avec sources.",
    defaultPermissions: ["rechercher_notes", "rechercher_fichiers", "resumer_document", "recherche_semantique", "rechercher_emails", "lire_email"],
  },
} as const satisfies Record<string, { name: string; icon: string; description: string; defaultPermissions: ToolName[] }>;

export type AgentKey = keyof typeof AGENTS;

/** Widgets de la rangée basse de l'accueil (trois emplacements, choisis par l'utilisateur). */
export const WIDGETS = {
  today: { label: "Aujourd'hui", hint: "Planning et tâches du jour", defaultSize: "sm" },
  school: { label: "École", hint: "Cours, devoirs, évaluations", defaultSize: "sm" },
  trend: { label: "Activité", hint: "Courbe de la période", defaultSize: "sm" },
  mini_calendar: { label: "Calendrier", hint: "Mois en cours", defaultSize: "sm" },
  briefing: { label: "Briefing du jour", hint: "Synthèse par l'IA", defaultSize: "sm" },
  deadlines: { label: "Échéances", hint: "7 prochains jours", defaultSize: "sm" },
  projects: { label: "Projets actifs", hint: "Avancement", defaultSize: "sm" },
  activity: { label: "Fil d'activité", hint: "Derniers changements", defaultSize: "sm" },
  quick_actions: { label: "Actions rapides", hint: "Créer en un clic", defaultSize: "sm" },
} as const;

export type WidgetKey = keyof typeof WIDGETS;
export const DEFAULT_WIDGETS: WidgetKey[] = ["today", "school", "trend", "mini_calendar", "briefing", "deadlines", "projects", "activity", "quick_actions"];
/** Nombre d'emplacements affichés sur l'accueil. */
export const WIDGET_SLOTS = 3;

export const TASK_STATUS = {
  todo: "À faire",
  in_progress: "En cours",
  review: "À vérifier",
  done: "Terminée",
} as const;
export type TaskStatus = keyof typeof TASK_STATUS;

export const PRIORITY = {
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
  urgent: "Urgente",
} as const;
export type Priority = keyof typeof PRIORITY;

export const PROJECT_STATUS = {
  planning: "En préparation",
  active: "Actif",
  paused: "En pause",
  completed: "Terminé",
  archived: "Archivé",
} as const;
export type ProjectStatus = keyof typeof PROJECT_STATUS;

export const MEMORY_CATEGORIES = {
  preference: "Préférences",
  project: "Contexte des projets",
  decision: "Décisions",
  goal: "Objectifs",
  method: "Méthodes de travail",
} as const;

/** Modèles proposés dans l'interface (le premier de chaque liste est le défaut). */
export const AI_MODELS: Record<string, { id: string; label: string; hint: string }[]> = {
  anthropic: [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Le plus capable" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Rapide et polyvalent" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "Le plus rapide" },
    { id: "claude-fable-5-1", label: "Claude Fable 5.1", hint: "Raisonnement poussé" },
  ],
  openai: [
    { id: "gpt-5", label: "GPT-5", hint: "OpenAI" },
    { id: "gpt-5-mini", label: "GPT-5 mini", hint: "OpenAI, rapide" },
  ],
  gemini: [
    { id: "gemini-flash-latest", label: "Gemini Flash", hint: "Offre gratuite" },
    { id: "gemini-flash-lite-latest", label: "Gemini Flash-Lite", hint: "Gratuit, le plus rapide" },
    { id: "gemini-pro-latest", label: "Gemini Pro", hint: "Quota gratuit réduit" },
  ],
};
