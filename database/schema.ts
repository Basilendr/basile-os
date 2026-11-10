/**
 * BASILE OS — schéma relationnel PostgreSQL.
 *
 * Règle d'isolation : chaque table métier porte `user_id` (FK → users, ON DELETE CASCADE)
 * et toutes les requêtes applicatives filtrent sur cette colonne (voir lib/scope.ts).
 * Des politiques RLS équivalentes sont définies dans database/rls.sql pour un déploiement
 * Supabase / multi-rôles.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  doublePrecision,
  numeric,
  date,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  customType,
  check,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ helpers */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const owner = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/** pgvector sans dimension fixe : la dimension dépend du fournisseur d'embeddings. */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return JSON.parse(value);
  },
});

/* ------------------------------------------------------------------ identité */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(), // "!" = connexion par mot de passe désactivée (compte Google)
  googleSub: text("google_sub").unique(),
  createdAt: createdAt(),
});

export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  locale: text("locale").notNull().default("fr"),
  timezone: text("timezone").notNull().default("Europe/Paris"),
  dateFormat: text("date_format").notNull().default("dd/MM/yyyy"),
  timeFormat: text("time_format").notNull().default("24h"),
  weatherCity: text("weather_city"),
  weatherLat: doublePrecision("weather_lat"),
  weatherLon: doublePrecision("weather_lon"),
  updatedAt: updatedAt(),
});

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("light"),
  accent: text("accent").notNull().default("#0071E3"),
  density: text("density").notNull().default("comfortable"),
  sidebarCollapsed: boolean("sidebar_collapsed").notNull().default(false),
  aiProvider: text("ai_provider").notNull().default("anthropic"),
  aiModel: text("ai_model").notNull().default("claude-opus-5-5"),
  memoryEnabled: boolean("memory_enabled").notNull().default(true),
  memoryCategories: text("memory_categories")
    .array()
    .notNull()
    .default(sql`ARRAY['preference','project','decision','goal','method']::text[]`),
  toolPermissions: jsonb("tool_permissions").$type<Record<string, "allow" | "confirm" | "deny">>().notNull().default({}),
  notificationPrefs: jsonb("notification_prefs").$type<Record<string, boolean>>().notNull().default({}),
  recentSearches: text("recent_searches").array().notNull().default(sql`ARRAY[]::text[]`),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // SHA-256 du jeton, jamais le jeton lui-même
    userId: owner(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const securityEvents = pgTable(
  "security_events",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // login.success, login.failure, logout, oauth.connect, token.revoke, email.send…
    ip: text("ip"),
    userAgent: text("user_agent"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("security_events_user_idx").on(t.userId, t.createdAt)],
);

/* ------------------------------------------------------------------ intégrations */

export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    userId: owner(),
    provider: text("provider").notNull(), // google | anthropic | openai
    service: text("service").notNull(), // gmail | calendar | drive | contacts | ai
    status: text("status").notNull().default("disconnected"), // disconnected | connected | error
    accountEmail: text("account_email"),
    scopes: text("scopes").array().notNull().default(sql`ARRAY[]::text[]`),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    syncState: jsonb("sync_state").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("integrations_user_service_uq").on(t.userId, t.service)],
);

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: id(),
    userId: owner(),
    provider: text("provider").notNull(),
    accountEmail: text("account_email"),
    accessTokenEnc: text("access_token_enc").notNull(), // AES-256-GCM
    refreshTokenEnc: text("refresh_token_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    scopes: text("scopes").array().notNull().default(sql`ARRAY[]::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("oauth_tokens_user_provider_uq").on(t.userId, t.provider)],
);

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }), // null = connexion avec Google
  purpose: text("purpose").notNull().default("connect"), // connect | login
  codeVerifier: text("code_verifier").notNull(),
  services: text("services").array().notNull(),
  returnTo: text("return_to"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ projets & tâches */

export const projects = pgTable(
  "projects",
  {
    id: id(),
    userId: owner(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    icon: text("icon").notNull().default("folder"),
    coverUrl: text("cover_url"),
    color: text("color").notNull().default("#6385FF"),
    status: text("status").notNull().default("active"), // planning | active | paused | completed | archived
    priority: text("priority").notNull().default("medium"),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("projects_user_idx").on(t.userId, t.status),
    check("projects_status_ck", sql`${t.status} in ('planning','active','paused','completed','archived')`),
    check("projects_priority_ck", sql`${t.priority} in ('low','medium','high','urgent')`),
  ],
);

export const projectMilestones = pgTable(
  "project_milestones",
  {
    id: id(),
    userId: owner(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueDate: date("due_date"),
    done: boolean("done").notNull().default(false),
    position: doublePrecision("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("milestones_project_idx").on(t.projectId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    userId: owner(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("todo"), // todo | in_progress | review | done
    priority: text("priority").notNull().default("medium"), // low | medium | high | urgent
    dueDate: date("due_date"),
    dueTime: text("due_time"), // HH:mm
    category: text("category"),
    position: doublePrecision("position").notNull().default(0),
    reminderAt: timestamp("reminder_at", { withTimezone: true }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    postponedCount: integer("postponed_count").notNull().default(0),
    sourceType: text("source_type"), // email | note | ai | automation
    sourceId: text("source_id"),
    attachments: jsonb("attachments").$type<{ fileId: string; name: string }[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_user_status_idx").on(t.userId, t.status),
    index("tasks_user_due_idx").on(t.userId, t.dueDate),
    index("tasks_project_idx").on(t.projectId),
    check("tasks_status_ck", sql`${t.status} in ('todo','in_progress','review','done')`),
    check("tasks_priority_ck", sql`${t.priority} in ('low','medium','high','urgent')`),
  ],
);

export const subtasks = pgTable(
  "subtasks",
  {
    id: id(),
    userId: owner(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    position: doublePrecision("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("subtasks_task_idx").on(t.taskId)],
);

/* ------------------------------------------------------------------ notes */

export const noteFolders = pgTable(
  "note_folders",
  {
    id: id(),
    userId: owner(),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    position: doublePrecision("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("note_folders_user_idx").on(t.userId)],
);

export const notes = pgTable(
  "notes",
  {
    id: id(),
    userId: owner(),
    folderId: uuid("folder_id").references(() => noteFolders.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull().default("Sans titre"),
    content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
    contentText: text("content_text").notNull().default(""),
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    favorite: boolean("favorite").notNull().default(false),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("notes_user_idx").on(t.userId, t.updatedAt), index("notes_project_idx").on(t.projectId)],
);

export const noteVersions = pgTable(
  "note_versions",
  {
    id: id(),
    userId: owner(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("note_versions_note_idx").on(t.noteId, t.revision)],
);

/* ------------------------------------------------------------------ fichiers */

export const files = pgTable(
  "files",
  {
    id: id(),
    userId: owner(),
    parentId: uuid("parent_id"), // dossier parent (files.is_folder = true)
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    isFolder: boolean("is_folder").notNull().default(false),
    mimeType: text("mime_type"),
    size: integer("size").notNull().default(0),
    storageKey: text("storage_key"), // chemin opaque dans le stockage privé
    sha256: text("sha256"),
    textContent: text("text_content"), // texte extrait pour la recherche / l'IA
    favorite: boolean("favorite").notNull().default(false),
    source: text("source").notNull().default("upload"), // upload | drive
    externalId: text("external_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("files_user_parent_idx").on(t.userId, t.parentId)],
);

/* ------------------------------------------------------------------ contacts */

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    userId: owner(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    company: text("company"),
    jobTitle: text("job_title"),
    notes: text("notes").notNull().default(""),
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    favorite: boolean("favorite").notNull().default(false),
    googleResourceName: text("google_resource_name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_user_idx").on(t.userId), index("contacts_email_idx").on(t.userId, t.email)],
);

/* ------------------------------------------------------------------ Google : cache local */

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: id(),
    userId: owner(),
    source: text("source").notNull().default("local"), // local | google
    calendarId: text("calendar_id").notNull().default("primary"),
    externalId: text("external_id"),
    etag: text("etag"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    location: text("location"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    timezone: text("timezone").notNull().default("Europe/Paris"),
    attendees: jsonb("attendees").$type<{ email: string; name?: string; status?: string }[]>().notNull().default([]),
    color: text("color"),
    recurrence: text("recurrence").array().notNull().default(sql`ARRAY[]::text[]`),
    reminders: jsonb("reminders").$type<{ method: string; minutes: number }[]>().notNull().default([]),
    status: text("status").notNull().default("confirmed"),
    htmlLink: text("html_link"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    prepNotes: text("prep_notes").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("events_user_start_idx").on(t.userId, t.startAt),
    uniqueIndex("events_external_uq").on(t.userId, t.calendarId, t.externalId),
  ],
);

export const emailMessages = pgTable(
  "email_messages",
  {
    id: id(),
    userId: owner(),
    gmailId: text("gmail_id").notNull(),
    threadId: text("thread_id").notNull(),
    historyId: text("history_id"),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    to: text("to").notNull().default(""),
    cc: text("cc").notNull().default(""),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    internalDate: timestamp("internal_date", { withTimezone: true }).notNull(),
    labelIds: text("label_ids").array().notNull().default(sql`ARRAY[]::text[]`),
    isUnread: boolean("is_unread").notNull().default(false),
    isStarred: boolean("is_starred").notNull().default(false),
    isImportant: boolean("is_important").notNull().default(false),
    hasAttachments: boolean("has_attachments").notNull().default(false),
    aiCategory: text("ai_category"),
    aiReason: text("ai_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("email_user_gmail_uq").on(t.userId, t.gmailId),
    index("email_user_date_idx").on(t.userId, t.internalDate),
    index("email_thread_idx").on(t.userId, t.threadId),
  ],
);

/* ------------------------------------------------------------------ notifications & activité */

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: owner(),
    type: text("type").notNull(), // email | email_important | event_soon | reminder | deadline | project | agent | automation | integration_error | system
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    href: text("href"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    importance: text("importance").notNull().default("normal"), // low | normal | high
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("notifications_dedupe_uq").on(t.userId, t.dedupeKey),
  ],
);

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: id(),
    userId: owner(),
    type: text("type").notNull(), // task.created, task.completed, project.updated, note.created, email.sent, ai.action, automation.run…
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    title: text("title").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("activity_user_idx").on(t.userId, t.createdAt), index("activity_entity_idx").on(t.entityType, t.entityId)],
);

export const dashboardWidgets = pgTable(
  "dashboard_widgets",
  {
    userId: owner(),
    widgetKey: text("widget_key").notNull(),
    position: integer("position").notNull(),
    size: text("size").notNull().default("md"), // sm | md | lg | full
    visible: boolean("visible").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.widgetKey] })],
);

/* ------------------------------------------------------------------ finances */

export const financialTransactions = pgTable(
  "financial_transactions",
  {
    id: id(),
    userId: owner(),
    kind: text("kind").notNull(), // income | expense
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("EUR"),
    category: text("category").notNull(),
    description: text("description").notNull().default(""),
    date: date("date").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("fin_tx_user_date_idx").on(t.userId, t.date),
    check("fin_tx_kind_ck", sql`${t.kind} in ('income','expense')`),
    check("fin_tx_amount_ck", sql`${t.amount} >= 0`),
  ],
);

export const budgets = pgTable(
  "budgets",
  {
    id: id(),
    userId: owner(),
    category: text("category").notNull(),
    monthlyAmount: numeric("monthly_amount", { precision: 12, scale: 2 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("budgets_user_cat_uq").on(t.userId, t.category)],
);

export const savingsGoals = pgTable("savings_goals", {
  id: id(),
  userId: owner(),
  name: text("name").notNull(),
  targetAmount: numeric("target_amount", { precision: 12, scale: 2 }).notNull(),
  currentAmount: numeric("current_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  dueDate: date("due_date"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ automatisations */

export type AutomationTrigger = { type: string; config: Record<string, unknown> };
export type AutomationCondition = { field: string; op: "eq" | "neq" | "contains" | "gt" | "lt" | "in"; value: unknown };
export type AutomationAction = { type: string; config: Record<string, unknown> };

export const automations = pgTable(
  "automations",
  {
    id: id(),
    userId: owner(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    enabled: boolean("enabled").notNull().default(false),
    trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
    conditions: jsonb("conditions").$type<AutomationCondition[]>().notNull().default([]),
    actions: jsonb("actions").$type<AutomationAction[]>().notNull().default([]),
    layout: jsonb("layout").$type<Record<string, { x: number; y: number }>>().notNull().default({}),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("automations_user_idx").on(t.userId, t.enabled)],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    userId: owner(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    triggerType: text("trigger_type").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull(), // running | success | failed | skipped | awaiting_approval
    attempt: integer("attempt").notNull().default(1),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    uniqueIndex("automation_runs_dedupe_uq").on(t.automationId, t.dedupeKey),
    index("automation_runs_user_idx").on(t.userId, t.startedAt),
  ],
);

/* ------------------------------------------------------------------ IA */

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: id(),
    userId: owner(),
    title: text("title").notNull().default("Nouvelle conversation"),
    kind: text("kind").notNull().default("assistant"), // assistant | command | agent
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_conv_user_idx").on(t.userId, t.updatedAt)],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: id(),
    userId: owner(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull().default(""),
    /** Blocs bruts du fournisseur (tool_use / tool_result) pour rejouer l'historique fidèlement. */
    blocks: jsonb("blocks").$type<unknown[]>().notNull().default([]),
    steps: jsonb("steps").$type<{ tool: string; status: string; summary: string }[]>().notNull().default([]),
    sources: jsonb("sources").$type<{ type: string; id: string; title: string; href: string }[]>().notNull().default([]),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("ai_msg_conv_idx").on(t.conversationId, t.createdAt)],
);

export const aiPendingActions = pgTable(
  "ai_pending_actions",
  {
    id: id(),
    userId: owner(),
    conversationId: uuid("conversation_id").references(() => aiConversations.id, { onDelete: "cascade" }),
    agentKey: text("agent_key"),
    tool: text("tool").notNull(),
    args: jsonb("args").$type<Record<string, unknown>>().notNull(),
    summary: text("summary").notNull(),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | executed | failed
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("ai_pending_user_idx").on(t.userId, t.status)],
);

export const aiMemory = pgTable(
  "ai_memory",
  {
    id: id(),
    userId: owner(),
    category: text("category").notNull(), // preference | project | decision | goal | method
    content: text("content").notNull(),
    sourceType: text("source_type"), // conversation | manual
    sourceId: text("source_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_memory_user_idx").on(t.userId)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    userId: owner(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    feature: text("feature").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_user_idx").on(t.userId, t.createdAt)],
);

export const agents = pgTable(
  "agents",
  {
    id: id(),
    userId: owner(),
    key: text("key").notNull(), // email | calendar | productivity | projects | research | personal
    enabled: boolean("enabled").notNull().default(true),
    permissions: text("permissions").array().notNull(),
    instructions: text("instructions").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("agents_user_key_uq").on(t.userId, t.key)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    userId: owner(),
    agentKey: text("agent_key").notNull(),
    input: text("input").notNull(),
    output: text("output").notNull().default(""),
    status: text("status").notNull().default("running"), // running | success | failed
    steps: jsonb("steps").$type<{ tool: string; status: string; summary: string }[]>().notNull().default([]),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("agent_runs_user_idx").on(t.userId, t.agentKey, t.startedAt)],
);

export const briefings = pgTable(
  "briefings",
  {
    id: id(),
    userId: owner(),
    date: date("date").notNull(),
    kind: text("kind").notNull().default("morning"), // morning | evening
    content: text("content").notNull(),
    sources: jsonb("sources").$type<{ type: string; id: string; title: string; href: string }[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("briefings_user_date_idx").on(t.userId, t.date)],
);

export const dailyPlans = pgTable(
  "daily_plans",
  {
    id: id(),
    userId: owner(),
    date: date("date").notNull(),
    status: text("status").notNull().default("draft"), // draft | accepted | rejected
    blocks: jsonb("blocks")
      .$type<{ id: string; start: string; end: string; title: string; kind: string; taskId?: string; accepted?: boolean; eventId?: string }[]>()
      .notNull()
      .default([]),
    rationale: text("rationale").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("daily_plans_user_date_uq").on(t.userId, t.date)],
);

/* ------------------------------------------------------------------ Second Brain */

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: id(),
    userId: owner(),
    kind: text("kind").notNull(), // idea | meeting | summary | reference | email
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("knowledge_user_idx").on(t.userId, t.kind)],
);

/** Graphe générique : relie deux entités quelconques (project, task, note, file, contact, email, event, knowledge). */
export const knowledgeRelationships = pgTable(
  "knowledge_relationships",
  {
    id: id(),
    userId: owner(),
    fromType: text("from_type").notNull(),
    fromId: text("from_id").notNull(),
    toType: text("to_type").notNull(),
    toId: text("to_id").notNull(),
    relation: text("relation").notNull().default("related"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("knowledge_rel_uq").on(t.userId, t.fromType, t.fromId, t.toType, t.toId, t.relation),
    index("knowledge_rel_to_idx").on(t.userId, t.toType, t.toId),
  ],
);

export const embeddings = pgTable(
  "embeddings",
  {
    id: id(),
    userId: owner(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    chunkIndex: integer("chunk_index").notNull().default(0),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    model: text("model").notNull(),
    dims: integer("dims").notNull(),
    embedding: vector("embedding").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("embeddings_entity_chunk_uq").on(t.userId, t.entityType, t.entityId, t.chunkIndex, t.model),
    index("embeddings_user_model_idx").on(t.userId, t.model),
  ],
);

/* ------------------------------------------------------------------ configuration de l'instance */

/** Secrets saisis depuis l'interface (clés IA, OAuth Google), chiffrés AES-256-GCM. Les variables d'environnement restent prioritaires. */
export const instanceSecrets = pgTable("instance_secrets", {
  name: text("name").primaryKey(),
  valueEnc: text("value_enc").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ École Directe */

export const schoolAccounts = pgTable("school_accounts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("ecoledirecte"),
  username: text("username").notNull(),
  passwordEnc: text("password_enc").notNull(),
  tokenEnc: text("token_enc"),
  faEnc: text("fa_enc"), // réponses cn/cv de la double authentification (réutilisables)
  accountId: integer("account_id"),
  accountType: text("account_type"), // E (élève) | 1 (famille)
  studentId: integer("student_id"),
  studentName: text("student_name"),
  schoolName: text("school_name"),
  className: text("class_name"),
  schoolYear: text("school_year"),
  status: text("status").notNull().default("disconnected"), // connected | qcm_required | error | disconnected
  pendingQcm: jsonb("pending_qcm").$type<{ question: string; propositions: string[]; tokenEnc: string; gtk: string } | null>(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  /** Agenda Google « École » tenu à jour avec l'emploi du temps, les devoirs et les évaluations. */
  gcalEnabled: boolean("gcal_enabled").notNull().default(true),
  gcalId: text("gcal_id"),
  gcalSyncedAt: timestamp("gcal_synced_at", { withTimezone: true }),
  gcalError: text("gcal_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const schoolMessages = pgTable(
  "school_messages",
  {
    id: id(),
    userId: owner(),
    externalId: integer("external_id").notNull(),
    folder: text("folder").notNull().default("received"),
    subject: text("subject").notNull().default(""),
    fromName: text("from_name").notNull().default(""),
    date: timestamp("date", { withTimezone: true }).notNull(),
    read: boolean("read").notNull().default(false),
    contentHtml: text("content_html"),
    files: jsonb("files").$type<{ id: number; name: string }[]>().notNull().default([]),
    /** Analyse par l'agent emploi du temps : date, et résumé de ce qui a été appliqué ("" : rien à appliquer). */
    agentAt: timestamp("agent_at", { withTimezone: true }),
    agentNote: text("agent_note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("school_messages_uq").on(t.userId, t.folder, t.externalId), index("school_messages_date_idx").on(t.userId, t.date)],
);

export const schoolLessons = pgTable(
  "school_lessons",
  {
    id: id(),
    userId: owner(),
    source: text("source").notNull().default("manual"), // ecoledirecte | manual
    externalId: text("external_id"),
    subject: text("subject").notNull(),
    subjectCode: text("subject_code"),
    teacher: text("teacher"),
    room: text("room"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    cancelled: boolean("cancelled").notNull().default(false),
    color: text("color"),
    kind: text("kind").notNull().default("COURS"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("school_lessons_ext_uq").on(t.userId, t.source, t.externalId), index("school_lessons_start_idx").on(t.userId, t.startAt)],
);

export const schoolHomework = pgTable(
  "school_homework",
  {
    id: id(),
    userId: owner(),
    source: text("source").notNull().default("manual"),
    externalId: text("external_id"),
    subject: text("subject").notNull(),
    subjectCode: text("subject_code"),
    title: text("title").notNull().default(""),
    contentHtml: text("content_html"),
    dueDate: date("due_date").notNull(),
    givenDate: date("given_date"),
    isTest: boolean("is_test").notNull().default(false), // évaluation / interrogation prévue
    done: boolean("done").notNull().default(false),
    teacher: text("teacher"),
    /** Documents Drive à réviser pour une évaluation (servent à générer les quiz J-7, J-3 et veille). */
    quizSources: jsonb("quiz_sources").$type<QuizSource[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("school_homework_ext_uq").on(t.userId, t.source, t.externalId), index("school_homework_due_idx").on(t.userId, t.dueDate)],
);

export const schoolGrades = pgTable(
  "school_grades",
  {
    id: id(),
    userId: owner(),
    source: text("source").notNull().default("manual"),
    externalId: text("external_id"),
    subject: text("subject").notNull(),
    title: text("title").notNull(),
    kind: text("kind"),
    value: text("value"), // texte : "15,5", "Abs", "Disp"…
    outOf: text("out_of").notNull().default("20"),
    coef: text("coef").notNull().default("1"),
    date: date("date").notNull(),
    period: text("period"),
    classAverage: text("class_average"),
    nonSignificant: boolean("non_significant").notNull().default(false),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("school_grades_ext_uq").on(t.userId, t.source, t.externalId), index("school_grades_date_idx").on(t.userId, t.date)],
);

/* ------------------------------------------------------------------ messagerie classique (IMAP / SMTP) */

/** Une adresse email « normale » (Orange, Free, iCloud, Yahoo, Outlook…), lue en IMAP et envoyée en SMTP. */
export const mailAccounts = pgTable("mail_accounts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  displayName: text("display_name"),
  username: text("username").notNull(),
  passwordEnc: text("password_enc").notNull(),
  imapHost: text("imap_host").notNull(),
  imapPort: integer("imap_port").notNull().default(993),
  imapSecure: boolean("imap_secure").notNull().default(true),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull().default(465),
  smtpSecure: boolean("smtp_secure").notNull().default(true),
  status: text("status").notNull().default("connected"), // connected | error
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const mailMessages = pgTable(
  "mail_messages",
  {
    id: id(),
    userId: owner(),
    folder: text("folder").notNull().default("INBOX"),
    uid: integer("uid").notNull(),
    messageId: text("message_id"),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    to: text("to").notNull().default(""),
    subject: text("subject").notNull().default(""),
    date: timestamp("date", { withTimezone: true }).notNull(),
    seen: boolean("seen").notNull().default(false),
    hasAttachments: boolean("has_attachments").notNull().default(false),
    html: text("html"),
    text: text("text"),
    attachments: jsonb("attachments").$type<{ name: string; size: number; type: string }[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mail_messages_uq").on(t.userId, t.folder, t.uid), index("mail_messages_date_idx").on(t.userId, t.date)],
);

/* ------------------------------------------------------------------ hébergement sans disque (Vercel) */

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    return Buffer.from(value);
  },
});

/** Contenu des fichiers importés quand le serveur n'a pas de disque permanent. */
export const fileBlobs = pgTable("file_blobs", {
  storageKey: uuid("storage_key").primaryKey(),
  userId: owner(),
  data: bytea("data").notNull(),
  createdAt: createdAt(),
});

/** Dernière exécution de chaque tâche périodique (partagée entre instances serverless). */
export const jobRuns = pgTable("job_runs", {
  name: text("name").primaryKey(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
});

/* ------------------------------------------------------------------ quiz de révision */

export type QuizSource = { id: string; name: string; mimeType?: string };
export type QuizQuestion = {
  id: string;
  type: "mcq" | "tf" | "open";
  prompt: string;
  /** QCM : propositions et index de la bonne réponse. */
  choices?: string[];
  answerIndex?: number;
  /** Vrai / faux. */
  answerBool?: boolean;
  /** Réponse ouverte : réponse attendue et variantes acceptées. */
  answer?: string;
  accepted?: string[];
  explanation: string;
  subject: string;
  topic: string;
  source?: string;
  difficulty: number;
  /** Question de révision issue d'une erreur passée. */
  review?: boolean;
};
export type QuizAnswer = { questionId: string; value: string; correct: boolean; feedback?: string; at: string };

/** Réglages des quiz : horaires de proposition et dossier Drive des cours. */
export const quizSettings = pgTable("quiz_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  weekdayHour: integer("weekday_hour").notNull().default(18),
  wednesdayHour: integer("wednesday_hour").notNull().default(14),
  weekendHour: integer("weekend_hour").notNull().default(10),
  questionCount: integer("question_count").notNull().default(10),
  folderId: text("folder_id"),
  folderName: text("folder_name"),
  updatedAt: updatedAt(),
});

/** Texte extrait des documents Drive (évite de relire et de retranscrire un cours déjà analysé). */
export const quizDocuments = pgTable(
  "quiz_documents",
  {
    id: id(),
    userId: owner(),
    driveId: text("drive_id").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    modifiedTime: text("modified_time").notNull(),
    text: text("text").notNull().default(""),
    /** Version précédente (jour d'avant) : sert à repérer ce qui a été ajouté au cours aujourd'hui. */
    baseText: text("base_text"),
    textDate: date("text_date"),
    error: text("error"),
    /** Matière devinée par l'IA pour un document rangé hors des dossiers de matières ("" : pas un cours). */
    subject: text("subject"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("quiz_documents_uq").on(t.userId, t.driveId)],
);

export const quizzes = pgTable(
  "quizzes",
  {
    id: id(),
    userId: owner(),
    kind: text("kind").notNull(), // daily | weekly | eval | custom | review
    title: text("title").notNull(),
    subject: text("subject"),
    status: text("status").notNull().default("generating"), // generating | ready | error | empty (aucun cours exploitable) | dismissed
    forDate: date("for_date").notNull(),
    homeworkId: uuid("homework_id").references(() => schoolHomework.id, { onDelete: "cascade" }),
    stage: text("stage"), // j7 | j3 | j1
    options: jsonb("options").$type<{ count?: number; difficulty?: string; focus?: string; fromQuizId?: string }>().notNull().default({}),
    sources: jsonb("sources").$type<QuizSource[]>().notNull().default([]),
    questions: jsonb("questions").$type<QuizQuestion[]>().notNull().default([]),
    keyPoints: jsonb("key_points").$type<string[]>().notNull().default([]),
    error: text("error"),
    tries: integer("tries").notNull().default(0),
    /** Clé d'unicité des quiz programmés (ex. daily:2026-11-09, eval:<id>:j3). */
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("quizzes_dedupe_uq").on(t.userId, t.dedupeKey), index("quizzes_date_idx").on(t.userId, t.forDate), index("quizzes_homework_idx").on(t.homeworkId)],
);

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: id(),
    userId: owner(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    answers: jsonb("answers").$type<QuizAnswer[]>().notNull().default([]),
    score: integer("score").notNull().default(0),
    total: integer("total").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("quiz_attempts_quiz_idx").on(t.userId, t.quizId), index("quiz_attempts_done_idx").on(t.userId, t.completedAt)],
);

/** Répétition espacée : chaque question ratée revient jusqu'à être maîtrisée (boîtes de Leitner). */
export const quizCards = pgTable(
  "quiz_cards",
  {
    id: id(),
    userId: owner(),
    key: text("key").notNull(),
    question: jsonb("question").$type<QuizQuestion>().notNull(),
    subject: text("subject").notNull().default(""),
    box: integer("box").notNull().default(1),
    dueDate: date("due_date").notNull(),
    lapses: integer("lapses").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("quiz_cards_uq").on(t.userId, t.key), index("quiz_cards_due_idx").on(t.userId, t.dueDate)],
);

/** Séances de travail du minuteur Pomodoro (temps de travail par matière). */
export const studySessions = pgTable(
  "study_sessions",
  {
    id: id(),
    userId: owner(),
    subject: text("subject").notNull(),
    homeworkId: uuid("homework_id").references(() => schoolHomework.id, { onDelete: "set null" }),
    minutes: integer("minutes").notNull(),
    /** false : séance arrêtée avant la fin. */
    completed: boolean("completed").notNull().default(true),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("study_sessions_user_idx").on(t.userId, t.endedAt)],
);

/**
 * Modifications de l'emploi du temps appliquées par-dessus celui d'École Directe :
 * lues dans les messages de la vie scolaire (agent), jours fériés et vacances scolaires.
 */
export const schoolChanges = pgTable(
  "school_changes",
  {
    id: id(),
    userId: owner(),
    source: text("source").notNull(), // message | holiday | vacation
    messageId: uuid("message_id").references(() => schoolMessages.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** Dernier jour (vacances) ; sinon égal à `date`. */
    endDate: date("end_date").notNull(),
    action: text("action").notNull(), // closed | cancel | change | add | event
    /** Créneau concerné (HH:MM), vide = toute la journée. */
    startTime: text("start_time"),
    endTime: text("end_time"),
    /** Cours d'origine visé par une annulation ou une modification. */
    matchStart: text("match_start"),
    matchSubject: text("match_subject"),
    subject: text("subject"),
    teacher: text("teacher"),
    room: text("room"),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("school_changes_date_idx").on(t.userId, t.date)],
);

/** Correspondance entre les éléments de l'emploi du temps et les événements de l'agenda Google « École ». */
export const schoolGcalEvents = pgTable(
  "school_gcal_events",
  {
    id: id(),
    userId: owner(),
    key: text("key").notNull(),
    googleId: text("google_id").notNull(),
    hash: text("hash").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("school_gcal_events_uq").on(t.userId, t.key)],
);

/** Emplois du temps envoyés par la vie scolaire (PDF), gardés pour être affichés tels quels. */
export const schoolDocuments = pgTable(
  "school_documents",
  {
    id: id(),
    userId: owner(),
    fileId: integer("file_id").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("school_documents_uq").on(t.userId, t.fileId)],
);

/** Abonnements aux notifications push (iPhone : app installée sur l'écran d'accueil). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: owner(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    device: text("device"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint)],
);
