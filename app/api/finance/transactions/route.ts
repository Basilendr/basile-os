import { z } from "zod";
import { route, zDate } from "@/lib/api";
import { TxInput, createTx, listTransactions } from "@/services/finance";

const Q = z.object({ from: zDate.optional(), to: zDate.optional(), category: z.string().max(60).optional(), kind: z.enum(["income", "expense"]).optional() });

export const GET = route({ query: Q }, async ({ db, user, query }) => ({ items: await listTransactions(db, user.id, query) }));
export const POST = route({ body: TxInput }, async ({ db, user, body }) => createTx(db, user.id, body));
