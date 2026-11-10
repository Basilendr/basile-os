import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { BudgetInput } from "@/services/finance";

export const POST = route({ body: BudgetInput }, async ({ db, user, body }) => {
  const [b] = await db.insert(schema.budgets).values({ ...body, userId: user.id }).onConflictDoUpdate({ target: [schema.budgets.userId, schema.budgets.category], set: { monthlyAmount: body.monthlyAmount } }).returning();
  return b;
});
