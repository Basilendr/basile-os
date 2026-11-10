/** Types côté client — reflet des réponses JSON des routes API (dates sérialisées en chaînes). */
import type { Priority, ProjectStatus, TaskStatus } from "@/lib/catalog";

export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  category: string | null;
  projectId: string | null;
  projectName?: string | null;
  projectColor?: string | null;
  position: number;
  reminderAt: string | null;
  completedAt: string | null;
  postponedCount: number;
  sourceType: string | null;
  sourceId: string | null;
  attachments: { fileId: string; name: string }[];
  subtaskTotal?: number;
  subtaskDone?: number;
  createdAt: string;
  updatedAt: string;
};

export type Subtask = { id: string; taskId: string; title: string; done: boolean; position: number };
export type TaskDetail = Task & { subtasks: Subtask[] };

export type TaskCounts = { today: number; upcoming: number; overdue: number; open: number; done: number; doneToday: number; all: number };

export type Project = {
  id: string;
  name: string;
  description: string;
  icon: string;
  coverUrl: string | null;
  color: string;
  status: ProjectStatus;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  taskTotal: number;
  taskDone: number;
  taskOverdue: number;
  nextDue: string | null;
  progress: number;
};

export type Activity = { id: string; type: string; title: string; entityType: string | null; entityId: string | null; meta: Record<string, unknown>; createdAt: string };

export type Milestone = { id: string; title: string; dueDate: string | null; done: boolean; position: number };

export type ProjectDetail = Omit<Project, "taskTotal" | "taskDone" | "taskOverdue" | "nextDue" | "progress"> & {
  tasks: Task[];
  notes: { id: string; title: string; updatedAt: string }[];
  files: { id: string; name: string; mimeType: string | null; size: number }[];
  milestones: Milestone[];
  activity: Activity[];
  events: { id: string; title: string; startAt: string }[];
  links: { id: string; fromType: string; fromId: string; toType: string; toId: string; relation: string }[];
  stats: { total: number; done: number; remaining: number; overdue: number; progress: number };
  progressSeries: { week: string; done: number; total: number }[];
};

export type NoteSummary = {
  id: string;
  title: string;
  excerpt: string;
  folderId: string | null;
  projectId: string | null;
  tags: string[];
  favorite: boolean;
  updatedAt: string;
  createdAt: string;
};

export type Note = NoteSummary & { content: Record<string, unknown>; contentText: string; revision: number };

export type CalendarEvent = {
  id: string;
  source: "local" | "google";
  calendarId: string;
  externalId: string | null;
  title: string;
  description: string;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  timezone: string;
  attendees: { email: string; name?: string; status?: string }[];
  color: string | null;
  recurrence: string[];
  reminders: { method: string; minutes: number }[];
  status: string;
  htmlLink: string | null;
  projectId: string | null;
  prepNotes: string;
};

/* ------------------------------------------------------------------ scolarité (École Directe + saisie manuelle) */
export type SchoolSource = "ecoledirecte" | "manual";
export type SchoolLesson = { id: string; source: SchoolSource; subject: string; subjectCode: string | null; teacher: string | null; room: string | null; startAt: string; endAt: string; cancelled: boolean; color: string | null; kind: string };
export type SchoolHomework = { id: string; source: SchoolSource; subject: string; subjectCode: string | null; title: string; contentHtml: string | null; dueDate: string; givenDate: string | null; isTest: boolean; done: boolean; teacher: string | null; quizSources?: { id: string; name: string; mimeType?: string }[] };
export type SchoolGrade = { id: string; source: SchoolSource; subject: string; title: string; kind: string | null; value: string | null; outOf: string; coef: string; date: string; period: string | null; classAverage: string | null; nonSignificant: boolean; comment: string | null };
export type SchoolMessage = { id: string; externalId: number; folder: string; subject: string; fromName: string | null; date: string; read: boolean; contentHtml: string | null; files: { id: number; name: string }[] };
export type SchoolAccount =
  | { status: "disconnected" }
  | {
      status: "connected" | "qcm_required" | "error";
      username: string;
      studentName: string | null;
      className: string | null;
      schoolName: string | null;
      schoolYear: string | null;
      lastSyncAt: string | null;
      lastError: string | null;
      qcm: { question: string; propositions: { index: number; label: string }[] } | null;
    };
export type SchoolSummary = { account: SchoolAccount; lessons: SchoolLesson[]; homework: SchoolHomework[]; tests: SchoolHomework[]; unreadMessages: number; average: number | null; lastGrade: SchoolGrade | null };
