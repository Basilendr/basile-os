import { describe, expect, it } from "vitest";
import { droppingSubjects, gradeSeries } from "@/components/school/grade-trend";
import type { SchoolGrade } from "@/types";

const g = (subject: string, date: string, value: string, outOf = "20", coef = "1"): SchoolGrade => ({ id: `${subject}${date}`, source: "ecoledirecte", subject, title: "DS", kind: null, value, outOf, coef, date, period: null, classAverage: null, nonSignificant: false, comment: null });

describe("graphique des notes", () => {
  it("ramène sur 20 et calcule la moyenne pondérée après chaque note", () => {
    const s = gradeSeries([g("Maths", "2026-10-02", "8", "10"), g("Maths", "2026-09-20", "10", "20", "2"), g("Maths", "2026-10-05", "Abs")]);
    expect(s.map((p) => [p.value, p.avg])).toEqual([
      [10, 10],
      [16, 12],
    ]);
  });

  it("repère une matière dont la moyenne baisse", () => {
    const grades = [g("SES", "2026-09-10", "16"), g("SES", "2026-11-05", "8"), g("Anglais", "2026-09-10", "12"), g("Anglais", "2026-11-05", "14")];
    expect(droppingSubjects(grades, "2026-11-10")).toEqual([{ subject: "SES", before: 16, now: 12, delta: -4 }]);
  });
});
