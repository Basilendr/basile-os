import {
  LayoutDashboard,
  House,
  Sparkles,
  Inbox,
  CalendarDays,
  CheckCircle2,
  FolderKanban,
  BrainCircuit,
  NotebookPen,
  FolderOpen,
  Users,
  Wallet,
  BarChart3,
  Workflow,
  Settings,
  Plug,
  Bell,
  HardDrive,
  Clock,
  BookOpen,
  ClipboardCheck,
  ListChecks,
  Timer,
  Search,
  Command,
  Bot,
  type LucideIcon,
} from "lucide-react";

/** Une destination : `also` regroupe les chemins qui l'activent aussi (onglets d'une même rubrique). */
export type NavLeaf = { href: string; label: string; icon: LucideIcon; shortcut?: string; also?: string[] };
export type FolderTone = "blue" | "green" | "violet" | "orange";
/** Un dossier regroupe plusieurs fonctionnalités, comme un dossier d'applications. */
export type NavFolder = { id: string; label: string; hint: string; tone: FolderTone; items: NavLeaf[] };

/** Accès directs, toujours visibles. */
export const SHORTCUTS: NavLeaf[] = [
  { href: "/", label: "Aujourd'hui", icon: House, shortcut: "G O" },
  { href: "/assistant", label: "Assistant IA", icon: Sparkles, shortcut: "G A", also: ["/command", "/agents"] },
  { href: "/inbox", label: "Messagerie", icon: Inbox, shortcut: "G I" },
];

/** Tout le reste est rangé dans quatre dossiers. */
export const FOLDERS: NavFolder[] = [
  {
    id: "organisation",
    label: "Organisation",
    hint: "Tâches · Agenda · Notes",
    tone: "blue",
    items: [
      { href: "/tasks", label: "Tâches", icon: CheckCircle2, shortcut: "G T" },
      { href: "/calendar", label: "Agenda", icon: CalendarDays, shortcut: "G C" },
      { href: "/projects", label: "Projets", icon: FolderKanban, shortcut: "G P" },
      { href: "/notes", label: "Notes", icon: NotebookPen, shortcut: "G N" },
    ],
  },
  {
    id: "ecole",
    label: "École",
    hint: "Cours · Quiz · Pomodoro",
    tone: "green",
    items: [
      { href: "/school?tab=timetable", label: "Emploi du temps", icon: Clock, shortcut: "G E" },
      { href: "/school?tab=homework", label: "Devoirs", icon: BookOpen },
      { href: "/school?tab=evals", label: "Évaluations", icon: ClipboardCheck },
      { href: "/quiz", label: "Quiz", icon: ListChecks, shortcut: "G Q" },
      { href: "/school?tab=focus", label: "Pomodoro", icon: Timer },
      { href: "/inbox?box=school", label: "Messages ED", icon: Inbox },
    ],
  },
  {
    id: "documents",
    label: "Documents",
    hint: "Fichiers · Drive · Savoir",
    tone: "violet",
    items: [
      { href: "/files", label: "Fichiers", icon: FolderOpen },
      { href: "/files?tab=drive", label: "Drive", icon: HardDrive },
      { href: "/brain", label: "Second Brain", icon: BrainCircuit },
      { href: "/search", label: "Recherche", icon: Search },
    ],
  },
  {
    id: "personnel",
    label: "Personnel",
    hint: "Budget · Contacts · Stats",
    tone: "orange",
    items: [
      { href: "/finance", label: "Finances", icon: Wallet },
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/overview", label: "Vue d'ensemble", icon: LayoutDashboard },
      { href: "/analytics", label: "Analyses", icon: BarChart3 },
      { href: "/automations", label: "Automatisations", icon: Workflow },
    ],
  },
];

/** Pages de l'assistant, présentées en onglets dans la page Assistant. */
export const ASSISTANT_TABS: NavLeaf[] = [
  { href: "/assistant", label: "Discussion", icon: Sparkles },
  { href: "/command", label: "Centre de commande", icon: Command },
  { href: "/agents", label: "Agents", icon: Bot },
];

export const SECONDARY: NavLeaf[] = [
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/integrations", label: "Intégrations", icon: Plug },
  { href: "/settings", label: "Paramètres", icon: Settings, shortcut: "G ," },
];

/** Toutes les destinations (palette de commandes, raccourcis clavier). */
export const NAV: NavLeaf[] = [...SHORTCUTS, ...FOLDERS.flatMap((f) => f.items), ...ASSISTANT_TABS.slice(1)];

const pathOf = (href: string) => href.split("?")[0];
const onPath = (pathname: string, path: string) => (path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(path + "/"));

export function isActive(pathname: string, href: string) {
  return onPath(pathname, pathOf(href));
}

/**
 * Destination active unique : le lien le plus précis gagne (même chemin, puis mêmes paramètres).
 * Sans paramètre dans l'URL, le premier lien d'un chemin est l'onglet par défaut.
 */
export function activeHref(pathname: string, search: URLSearchParams): string | null {
  const leaves = [...SHORTCUTS, ...FOLDERS.flatMap((f) => f.items), ...SECONDARY];
  let best: { href: string; score: number } | null = null;
  for (const leaf of leaves) {
    const paths = [pathOf(leaf.href), ...(leaf.also ?? [])];
    if (!paths.some((p) => onPath(pathname, p))) continue;
    const want = new URLSearchParams(leaf.href.split("?")[1] ?? "");
    let score = 1;
    let ok = true;
    for (const [k, v] of want) {
      const got = search.get(k);
      if (got === v) score += 2;
      else if (got === null && leaves.find((l) => pathOf(l.href) === pathOf(leaf.href)) === leaf) score += 1;
      else ok = false;
    }
    if (ok && (!best || score > best.score)) best = { href: leaf.href, score };
  }
  return best?.href ?? null;
}

/** Dossier contenant la page courante (pour l'ouvrir et pour le fil d'Ariane). */
export function folderOf(href: string | null) {
  return href ? (FOLDERS.find((f) => f.items.some((i) => i.href === href)) ?? null) : null;
}

/** Couleurs des dossiers : teinte de fond, icône et pastille, en clair comme en sombre. */
export const TONES: Record<FolderTone, { fg: string; soft: string; strong: string }> = {
  blue: { fg: "var(--tone-blue)", soft: "color-mix(in srgb, var(--tone-blue) 11%, transparent)", strong: "color-mix(in srgb, var(--tone-blue) 22%, transparent)" },
  green: { fg: "var(--tone-green)", soft: "color-mix(in srgb, var(--tone-green) 11%, transparent)", strong: "color-mix(in srgb, var(--tone-green) 22%, transparent)" },
  violet: { fg: "var(--tone-violet)", soft: "color-mix(in srgb, var(--tone-violet) 11%, transparent)", strong: "color-mix(in srgb, var(--tone-violet) 22%, transparent)" },
  orange: { fg: "var(--tone-orange)", soft: "color-mix(in srgb, var(--tone-orange) 12%, transparent)", strong: "color-mix(in srgb, var(--tone-orange) 24%, transparent)" },
};
