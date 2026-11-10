import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { zDate } from "@/lib/api";
import { rowsOf } from "@/lib/sql";
import { logActivity } from "./activity";

const money = z.coerce.number().min(0).max(1e9).transform((n) => n.toFixed(2));

export const TxInput = z.object({
  kind: z.enum(["income", "expense"]),
  amount: money,
  currency: z.string().length(3).default("EUR"),
  category: z.string().trim().min(1).max(60),
  description: z.string().max(500).default(""),
  date: zDate,
});
export const BudgetInput = z.object({ category: z.string().trim().min(1).max(60), monthlyAmount: money });
export const GoalInput = z.object({ name: z.string().trim().min(1).max(120), targetAmount: money, currentAmount: money.default("0.00"), dueDate: zDate.nullable().optional() });

export async function listTransactions(db: DB, userId: string, q: { from?: string; to?: string; category?: string; kind?: string }) {
  const t = schema.financialTransactions;
  const where = [eq(t.userId, userId)];
  if (q.from) where.push(gte(t.date, q.from));
  if (q.to) where.push(lte(t.date, q.to));
  if (q.category) where.push(eq(t.category, q.category));
  if (q.kind) where.push(eq(t.kind, q.kind));
  return db.select().from(t).where(and(...where)).orderBy(desc(t.date), desc(t.createdAt)).limit(2000);
}

export async function createTx(db: DB, userId: string, raw: z.input<typeof TxInput>) {
  const i = TxInput.parse(raw);
  const [r] = await db.insert(schema.financialTransactions).values({ ...i, userId }).returning();
  await logActivity(db, userId, { type: "finance.transaction", title: `${i.kind === "income" ? "Revenu" : "Dépense"} enregistré(e) : ${i.category}`, entityType: "transaction", entityId: r.id });
  return r;
}
export async function updateTx(db: DB, userId: string, id: string, raw: Partial<z.input<typeof TxInput>>) {
  const [r] = await db.update(schema.financialTransactions).set(TxInput.partial().parse(raw)).where(and(eq(schema.financialTransactions.id, id), eq(schema.financialTransactions.userId, userId))).returning();
  if (!r) throw notFound("Transaction");
  return r;
}
export async function deleteTx(db: DB, userId: string, id: string) {
  const r = await db.delete(schema.financialTransactions).where(and(eq(schema.financialTransactions.id, id), eq(schema.financialTransactions.userId, userId))).returning();
  if (!r.length) throw notFound("Transaction");
}

/** Rapport mensuel calculé uniquement à partir des transactions saisies. */
export async function report(db: DB, userId: string, month: string) {
  const start = `${month}-01`;
  const d = new Date(`${start}T00:00:00`);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const endS = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  const t = schema.financialTransactions;
  const byCat = await db
    .select({ kind: t.kind, category: t.category, total: sql<string>`sum(${t.amount})`, n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(eq(t.userId, userId), gte(t.date, start), lte(t.date, endS)))
    .groupBy(t.kind, t.category);
  const budgets = await db.select().from(schema.budgets).where(eq(schema.budgets.userId, userId));
  const goals = await db.select().from(schema.savingsGoals).where(eq(schema.savingsGoals.userId, userId));
  const series = rowsOf<{ month: string; income: string; expense: string }>(
    await db.execute(sql`
      with months as (select generate_series(date_trunc('month', ${start}::date) - interval '11 months', date_trunc('month', ${start}::date), interval '1 month') m)
      select to_char(m, 'YYYY-MM') as month,
        coalesce((select sum(amount) from ${t} where user_id = ${userId} and kind = 'income' and date_trunc('month', date) = m), 0) as income,
        coalesce((select sum(amount) from ${t} where user_id = ${userId} and kind = 'expense' and date_trunc('month', date) = m), 0) as expense
      from months order by m`),
  );
  const income = byCat.filter((r) => r.kind === "income").reduce((a, r) => a + Number(r.total), 0);
  const expense = byCat.filter((r) => r.kind === "expense").reduce((a, r) => a + Number(r.total), 0);
  return {
    month,
    income,
    expense,
    balance: income - expense,
    byCategory: byCat.map((r) => ({ ...r, total: Number(r.total) })).sort((a, b) => b.total - a.total),
    budgets: budgets.map((b) => {
      const spent = byCat.filter((r) => r.kind === "expense" && r.category === b.category).reduce((a, r) => a + Number(r.total), 0);
      return { ...b, monthlyAmount: Number(b.monthlyAmount), spent, ratio: Number(b.monthlyAmount) ? spent / Number(b.monthlyAmount) : 0 };
    }),
    goals: goals.map((g) => ({ ...g, targetAmount: Number(g.targetAmount), currentAmount: Number(g.currentAmount) })),
    series: series.map((s) => ({ month: s.month, income: Number(s.income), expense: Number(s.expense) })),
    categories: [...new Set(byCat.map((r) => r.category))],
  };
}
