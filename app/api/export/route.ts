import { eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { logSecurityEvent } from "@/lib/auth";

/** Export complet des données personnelles (JSON). Les jetons et secrets sont exclus. */
export const GET = route({ rate: [5, 60_000] }, async ({ db, user }) => {
  const t = schema;
  const q = async (table: typeof t.tasks | typeof t.projects | typeof t.notes | typeof t.contacts | typeof t.calendarEvents | typeof t.financialTransactions | typeof t.budgets | typeof t.savingsGoals | typeof t.automations | typeof t.aiConversations | typeof t.aiMessages | typeof t.aiMemory | typeof t.knowledgeItems | typeof t.knowledgeRelationships | typeof t.subtasks | typeof t.projectMilestones | typeof t.noteFolders | typeof t.activityLogs | typeof t.notifications) =>
    db.select().from(table).where(eq(table.userId, user.id));
  const [profile] = await db.select().from(t.profiles).where(eq(t.profiles.userId, user.id));
  const files = await db.select({ id: t.files.id, name: t.files.name, isFolder: t.files.isFolder, mimeType: t.files.mimeType, size: t.files.size, parentId: t.files.parentId, projectId: t.files.projectId, createdAt: t.files.createdAt }).from(t.files).where(eq(t.files.userId, user.id));
  const data = {
    exportedAt: new Date().toISOString(),
    account: { email: user.email, profile },
    tasks: await q(t.tasks),
    subtasks: await q(t.subtasks),
    projects: await q(t.projects),
    milestones: await q(t.projectMilestones),
    notes: await q(t.notes),
    noteFolders: await q(t.noteFolders),
    files,
    contacts: await q(t.contacts),
    calendarEvents: await q(t.calendarEvents),
    transactions: await q(t.financialTransactions),
    budgets: await q(t.budgets),
    savingsGoals: await q(t.savingsGoals),
    automations: await q(t.automations),
    conversations: await q(t.aiConversations),
    messages: await q(t.aiMessages),
    memory: await q(t.aiMemory),
    knowledge: await q(t.knowledgeItems),
    relationships: await q(t.knowledgeRelationships),
    activity: await q(t.activityLogs),
    notifications: await q(t.notifications),
  };
  await logSecurityEvent(user.id, "data.exported");
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="basile-os-export-${new Date().toISOString().slice(0, 10)}.json"` },
  });
});
