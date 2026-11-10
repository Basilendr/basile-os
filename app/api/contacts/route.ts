import { z } from "zod";
import { route } from "@/lib/api";
import { ContactInput, createContact, listContacts } from "@/services/contacts";

const Q = z.object({ q: z.string().max(200).optional(), tag: z.string().max(40).optional(), favorite: z.enum(["1"]).optional(), company: z.string().max(200).optional() });

export const GET = route({ query: Q }, async ({ db, user, query }) => ({ items: await listContacts(db, user.id, { ...query, favorite: !!query.favorite }) }));
export const POST = route({ body: ContactInput }, async ({ db, user, body }) => createContact(db, user.id, body));
