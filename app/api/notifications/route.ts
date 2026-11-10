import { z } from "zod";
import { route } from "@/lib/api";
import { listNotifications, unreadCount } from "@/services/notifications";

const Q = z.object({ unread: z.enum(["1", "0"]).optional(), type: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(200).optional() });

export const GET = route({ query: Q }, async ({ db, user, query }) => ({
  items: await listNotifications(db, user.id, { unreadOnly: query.unread === "1", type: query.type, limit: query.limit }),
  unread: await unreadCount(db, user.id),
}));
