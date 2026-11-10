import { z } from "zod";
import { route } from "@/lib/api";
import { ProjectCreate, createProject, listProjects } from "@/services/projects";

const Q = z.object({ status: z.string().max(20).optional(), archived: z.enum(["1"]).optional() });

export const GET = route({ query: Q }, async ({ db, user, query }) => ({ items: await listProjects(db, user.id, { status: query.status, includeArchived: !!query.archived }) }));
export const POST = route({ body: ProjectCreate }, async ({ db, user, body }) => createProject(db, user.id, body));
