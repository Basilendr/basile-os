const BY_PAGE: Record<string, string[]> = {
  "/": ["Présente-moi mes priorités actuelles.", "Organise ma journée.", "Résume les informations importantes de cette semaine."],
  "/inbox": ["Trouve les emails importants auxquels je n'ai pas répondu.", "Transforme mes emails importants en tâches.", "Résume ma boîte de réception du jour."],
  "/calendar": ["Trouve un créneau libre de deux heures demain.", "Prépare mon prochain rendez-vous.", "Détecte les conflits dans mon agenda de la semaine."],
  "/tasks": ["Hiérarchise mes tâches pour aujourd'hui.", "Quelles tâches sont régulièrement reportées ?", "Décompose ma tâche la plus urgente en étapes."],
  "/projects": ["Quels projets sont bloqués ou en retard ?", "Propose les prochaines actions de mes projets actifs.", "Rédige un rapport hebdomadaire de mes projets."],
  "/notes": ["Transforme ma dernière note en plan d'action.", "Retrouve mes notes sur les tarifs.", "Résume mes notes de la semaine."],
  "/files": ["Trouve les documents associés à mes projets.", "Résume le dernier document importé."],
  "/finance": ["Résume mes dépenses de ce mois à partir des transactions saisies."],
  "/brain": ["Relie mes notes et documents à leurs projets.", "Que sais-je sur mon projet principal ?"],
};

export function suggestionsFor(path: string) {
  const base = "/" + (path.split("/")[1] ?? "");
  return BY_PAGE[base] ?? BY_PAGE["/"];
}

export const COMMAND_SUGGESTIONS = [
  "Prépare ma journée de demain.",
  "Organise ma journée.",
  "Trouve les emails importants auxquels je n'ai pas répondu.",
  "Crée un projet pour ma nouvelle idée : ",
  "Trouve un créneau libre de deux heures demain.",
  "Résume les informations importantes de cette semaine.",
  "Transforme mes emails importants en tâches.",
  "Trouve les documents associés à ce projet : ",
  "Présente-moi mes priorités actuelles.",
  "Prépare mon rendez-vous de demain.",
];
