/** Catalogue des déclencheurs et actions (partagé client/serveur, sans secret). */

export type FieldDef = { key: string; label: string; type: "text" | "textarea" | "number" | "select" | "time" | "boolean"; options?: { value: string; label: string }[]; placeholder?: string };

export const TRIGGERS: Record<string, { label: string; description: string; fields: string[]; config?: FieldDef[] }> = {
  "email.received": { label: "Email reçu", description: "Nouvel email dans la boîte de réception (Gmail connecté)", fields: ["data.subject", "data.from", "data.fromName", "data.snippet", "data.important"] },
  "email.important": { label: "Email important reçu", description: "Email marqué important par Gmail", fields: ["data.subject", "data.from", "data.snippet"] },
  "deadline.near": { label: "Échéance proche", description: "Tâche due aujourd'hui, demain, ou en retard", fields: ["data.title", "data.dueDate", "data.priority", "data.overdue"] },
  "event.created": { label: "Nouvel événement", description: "Événement créé dans le calendrier", fields: ["data.title", "data.startAt"] },
  "task.completed": { label: "Tâche terminée", description: "Une tâche passe au statut Terminée", fields: ["data.title", "data.projectId", "data.priority"] },
  "task.created": { label: "Tâche créée", description: "Nouvelle tâche", fields: ["data.title", "data.priority", "data.projectId"] },
  "project.created": { label: "Nouveau projet", description: "Un projet est créé", fields: ["data.name", "data.priority"] },
  "file.uploaded": { label: "Fichier ajouté", description: "Import d'un fichier", fields: ["data.name", "data.mimeType"] },
  "note.created": { label: "Note créée", description: "Nouvelle note", fields: ["data.title"] },
  "schedule.daily": {
    label: "Chaque jour",
    description: "À une heure fixe, une fois par jour",
    fields: ["data.date"],
    config: [{ key: "time", label: "Heure", type: "time" }, { key: "timezone", label: "Fuseau horaire", type: "text", placeholder: "Europe/Paris" }],
  },
  manual: { label: "Manuel", description: "Lancé depuis la palette ou le bouton Exécuter", fields: [] },
};

export const ACTIONS: Record<string, { label: string; description: string; sensitive?: boolean; config: FieldDef[] }> = {
  notify: {
    label: "Créer une notification",
    description: "Ajoute une alerte dans le centre de notifications",
    config: [
      { key: "title", label: "Titre", type: "text", placeholder: "Email important : {{data.subject}}" },
      { key: "body", label: "Message", type: "textarea", placeholder: "De {{data.from}}" },
      { key: "importance", label: "Importance", type: "select", options: [{ value: "normal", label: "Normale" }, { value: "high", label: "Haute" }] },
    ],
  },
  create_task: {
    label: "Créer une tâche",
    description: "Crée immédiatement une tâche",
    config: [
      { key: "title", label: "Titre", type: "text", placeholder: "Rappel : {{data.title}}" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "dueInDays", label: "Échéance dans (jours)", type: "number", placeholder: "1" },
      { key: "priority", label: "Priorité", type: "select", options: [{ value: "low", label: "Faible" }, { value: "medium", label: "Moyenne" }, { value: "high", label: "Élevée" }, { value: "urgent", label: "Urgente" }] },
    ],
  },
  propose_task: {
    label: "Proposer une tâche",
    description: "Prépare une tâche à valider (rien n'est créé sans accord)",
    config: [
      { key: "title", label: "Titre", type: "text", placeholder: "Traiter : {{data.subject}}" },
      { key: "description", label: "Description", type: "textarea", placeholder: "{{data.snippet}}" },
    ],
  },
  event_checklist: { label: "Checklist de préparation", description: "Crée une tâche de préparation avec sous-tâches", config: [{ key: "items", label: "Éléments (un par ligne)", type: "textarea", placeholder: "Relire l'ordre du jour\nPréparer les documents" }] },
  project_progress: { label: "Actualiser le projet", description: "Notifie l'avancement du projet de la tâche", config: [{ key: "autoComplete", label: "Marquer le projet terminé à 100 %", type: "boolean" }] },
  find_related_docs: { label: "Rechercher les documents liés", description: "Relie notes et fichiers pertinents dans le Second Brain", config: [] },
  project_structure: { label: "Structure initiale de projet", description: "Ajoute des étapes au nouveau projet", config: [{ key: "items", label: "Étapes (une par ligne)", type: "textarea", placeholder: "Cadrage\nConception\nRéalisation\nLivraison" }] },
  generate_briefing: { label: "Générer le briefing IA", description: "Prépare le briefing quotidien (IA configurée requise)", config: [] },
  send_email: {
    label: "Préparer un email",
    description: "Prépare un email — envoi uniquement après ta confirmation",
    sensitive: true,
    config: [
      { key: "to", label: "Destinataire", type: "text" },
      { key: "subject", label: "Objet", type: "text" },
      { key: "body", label: "Message", type: "textarea" },
    ],
  },
};

export const OPS = { eq: "est égal à", neq: "est différent de", contains: "contient", gt: "supérieur à", lt: "inférieur à", in: "parmi (liste)" } as const;

/** Modèles prêts à l'emploi (exemples du cahier des charges). */
export const TEMPLATES = [
  { name: "Email important → notification", trigger: { type: "email.important", config: {} }, conditions: [], actions: [{ type: "notify", config: { title: "Email important : {{data.subject}}", body: "De {{data.from}}", importance: "high" } }] },
  { name: "Échéance proche → rappel", trigger: { type: "deadline.near", config: {} }, conditions: [{ field: "data.overdue", op: "eq", value: "false" }], actions: [{ type: "notify", config: { title: "Échéance : {{data.title}}", body: "Prévue le {{data.dueDate}}" } }] },
  { name: "Nouvel événement → checklist", trigger: { type: "event.created", config: {} }, conditions: [], actions: [{ type: "event_checklist", config: {} }] },
  { name: "Tâche terminée → actualiser le projet", trigger: { type: "task.completed", config: {} }, conditions: [], actions: [{ type: "project_progress", config: {} }] },
  { name: "Chaque matin → briefing", trigger: { type: "schedule.daily", config: { time: "07:30", timezone: "Europe/Paris" } }, conditions: [], actions: [{ type: "generate_briefing", config: {} }] },
  { name: "Email avec échéance → proposer une tâche", trigger: { type: "email.received", config: {} }, conditions: [{ field: "data.snippet", op: "contains", value: "avant le" }], actions: [{ type: "propose_task", config: { title: "Traiter : {{data.subject}}" } }] },
  { name: "Nouveau projet → structure initiale", trigger: { type: "project.created", config: {} }, conditions: [], actions: [{ type: "project_structure", config: {} }] },
  { name: "Rendez-vous → documents associés", trigger: { type: "event.created", config: {} }, conditions: [], actions: [{ type: "find_related_docs", config: {} }] },
] as const;
