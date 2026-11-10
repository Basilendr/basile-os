import { describe, expect, it, vi } from "vitest";
import { setup } from "./helpers";

describe("hébergement serverless", () => {
  it("ne lance chaque tâche périodique qu'une fois par intervalle, même appelée deux fois", async () => {
    const { db } = await setup();
    const { runDueJobs } = await import("@/services/scheduler");
    const first = await runDueJobs(db);
    expect(first).toContain("task-reminders");
    expect(await runDueJobs(db)).toEqual([]);
  });

  it("stocke le contenu des fichiers en base quand FILE_STORAGE=db", async () => {
    vi.resetModules();
    process.env.FILE_STORAGE = "db";
    const { db, userId } = await setup();
    const files = await import("@/services/files");
    const row = await files.uploadFile(db, userId, new File(["bonjour"], "note.txt", { type: "text/plain" }), { parentId: null });
    const { data } = await files.readFileBytes(db, userId, row.id);
    expect(Buffer.from(data).toString()).toBe("bonjour");
    await files.deleteFile(db, userId, row.id);
    const { schema } = await import("@/lib/db");
    expect(await db.select().from(schema.fileBlobs)).toHaveLength(0);
    delete process.env.FILE_STORAGE;
  });
});
