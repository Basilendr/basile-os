import { z } from "zod";
import { ACTIONS, TRIGGERS } from "@/services/automations/catalog";

export const AutomationInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).default(""),
  enabled: z.boolean().default(false),
  trigger: z.object({ type: z.enum(Object.keys(TRIGGERS) as [string, ...string[]]), config: z.record(z.string(), z.unknown()).default({}) }),
  conditions: z.array(z.object({ field: z.string().max(80), op: z.enum(["eq", "neq", "contains", "gt", "lt", "in"]), value: z.unknown() })).max(10).default([]),
  actions: z.array(z.object({ type: z.enum(Object.keys(ACTIONS) as [string, ...string[]]), config: z.record(z.string(), z.unknown()).default({}) })).min(1, "Au moins une action").max(10),
  layout: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).default({}),
});
