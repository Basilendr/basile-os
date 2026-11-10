import { beforeAll, describe, expect, it } from "vitest";
import { setup } from "./helpers";
import type { DB } from "@/lib/db";

let db: DB;
let userId: string;
beforeAll(async () => ({ db, userId } = await setup()));

describe("minuteur Pomodoro", () => {
  it("enregistre les séances et calcule le temps par matière, par jour et la série", async () => {
    const { schema } = await import("@/lib/db");
    const { deleteSession, focusOverview, prettySubject, recordSession } = await import("@/services/school/focus");
    const { addHomework } = await import("@/services/school/school");
    expect(prettySubject("SCIENCES VIE & TERRE")).toBe("Sciences Vie & Terre");
    expect(prettySubject("ESPAGNOL LV2")).toBe("Espagnol LV2");
    expect(prettySubject("HGGSP")).toBe("HGGSP");

    const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
    const hw = await addHomework(db, userId, { subject: "FRANCAIS", title: "Dissertation", dueDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), isTest: true });
    await recordSession(db, userId, { subject: "SES", minutes: 25, startedAt: at(60), endedAt: at(35) });
    await recordSession(db, userId, { subject: "SES", minutes: 25, startedAt: at(30), endedAt: at(5) });
    const partial = await recordSession(db, userId, { subject: "Français", homeworkId: hw.id, minutes: 12, completed: false, startedAt: at(20), endedAt: at(8) });
    await db.insert(schema.schoolLessons).values({ userId, subject: "REPAS SELF", startAt: new Date(), endAt: new Date(Date.now() + 3600_000) });
    await db.insert(schema.schoolLessons).values({ userId, subject: "SCIENCES VIE & TERRE", startAt: new Date(), endAt: new Date(Date.now() + 3600_000) });
    await expect(recordSession(db, userId, { subject: "", minutes: 25, startedAt: at(1), endedAt: at(0) })).rejects.toThrow();

    const o = await focusOverview(db, userId);
    expect(o.today).toMatchObject({ minutes: 62, sessions: 2 });
    expect(o.week.minutes).toBe(62);
    expect(o.bySubject).toEqual([{ subject: "SES", minutes: 50 }, { subject: "Français", minutes: 12 }]);
    expect(o.streak).toBe(1);
    expect(o.subjects).toEqual(expect.arrayContaining(["SES", "Français", "Sciences Vie & Terre"]));
    expect(o.subjects.some((s) => /repas/i.test(s))).toBe(false);
    expect(o.subjects.filter((s) => /fran/i.test(s))).toHaveLength(1); // FRANCAIS et Français ne font qu'un
    expect(o.tests.map((t) => t.id)).toEqual([hw.id]);

    await deleteSession(db, userId, partial.id);
    expect((await focusOverview(db, userId)).today.minutes).toBe(50);
  });
});
