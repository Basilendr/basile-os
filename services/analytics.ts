import "server-only";
import { sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { rowsOf } from "@/lib/sql";

export type Period = "7d" | "30d" | "90d" | "12m";
const CFG: Record<Period, { days: number; bucket: "day" | "week" | "month" }> = { "7d": { days: 7, bucket: "day" }, "30d": { days: 30, bucket: "day" }, "90d": { days: 90, bucket: "week" }, "12m": { days: 365, bucket: "month" } };

/** Statistiques calculées exclusivement à partir des données réelles de l'utilisateur. */
export async function analytics(db: DB, userId: string, period: Period) {
  const { days, bucket } = CFG[period];
  const step = `1 ${bucket}`;
  const fmt = bucket === "month" ? "YYYY-MM" : "YYYY-MM-DD";
  const t = schema.tasks;
  const series = rowsOf<{ b: string; created: number; completed: number; events_minutes: number; emails_in: number; emails_out: number }>(
    await db.execute(sql`
      with b as (select generate_series(date_trunc(${bucket}, now() - make_interval(days => ${days - 1})), date_trunc(${bucket}, now()), ${step}::interval) s)
      select to_char(s, ${fmt}) as b,
        (select count(*)::int from ${t} where user_id = ${userId} and date_trunc(${bucket}, created_at) = s) as created,
        (select count(*)::int from ${t} where user_id = ${userId} and completed_at is not null and date_trunc(${bucket}, completed_at) = s) as completed,
        (select coalesce(sum(extract(epoch from (end_at - start_at)) / 60), 0)::int from ${schema.calendarEvents} where user_id = ${userId} and not all_day and status = 'confirmed' and date_trunc(${bucket}, start_at) = s) as events_minutes,
        (select count(*)::int from ${schema.emailMessages} where user_id = ${userId} and 'INBOX' = any(label_ids) and date_trunc(${bucket}, internal_date) = s) as emails_in,
        (select count(*)::int from ${schema.emailMessages} where user_id = ${userId} and 'SENT' = any(label_ids) and date_trunc(${bucket}, internal_date) = s) as emails_out
      from b order by s`),
  );
  const [totals] = rowsOf<{ completed: number; created: number; overdue: number; open: number; postponed: number; on_time: number; done_with_due: number }>(
    await db.execute(sql`
      select
        count(*) filter (where completed_at > now() - make_interval(days => ${days}))::int as completed,
        count(*) filter (where created_at > now() - make_interval(days => ${days}))::int as created,
        count(*) filter (where status <> 'done' and due_date < current_date)::int as overdue,
        count(*) filter (where status <> 'done')::int as open,
        count(*) filter (where postponed_count >= 2 and status <> 'done')::int as postponed,
        count(*) filter (where completed_at > now() - make_interval(days => ${days}) and due_date is not null and completed_at::date <= due_date)::int as on_time,
        count(*) filter (where completed_at > now() - make_interval(days => ${days}) and due_date is not null)::int as done_with_due
      from ${t} where user_id = ${userId}`),
  );
  const projects = rowsOf<{ id: string; name: string; color: string; progress: number; done_period: number; total: number }>(
    await db.execute(sql`
      select p.id, p.name, p.color,
        coalesce(round(100.0 * count(t.id) filter (where t.status = 'done') / nullif(count(t.id), 0)), 0)::int as progress,
        count(t.id) filter (where t.completed_at > now() - make_interval(days => ${days}))::int as done_period,
        count(t.id)::int as total
      from ${schema.projects} p left join ${t} t on t.project_id = p.id
      where p.user_id = ${userId} and p.status in ('active','planning')
      group by p.id order by done_period desc, progress desc limit 8`),
  );
  const postponed = rowsOf<{ id: string; title: string; postponed_count: number; due_date: string | null }>(
    await db.execute(sql`select id, title, postponed_count, due_date from ${t} where user_id = ${userId} and status <> 'done' and postponed_count >= 2 order by postponed_count desc limit 8`),
  );
  const weekday = rowsOf<{ dow: number; events: number; completed: number }>(
    await db.execute(sql`
      select d.dow,
        (select count(*)::int from ${schema.calendarEvents} e where e.user_id = ${userId} and extract(isodow from e.start_at) = d.dow and e.start_at > now() - make_interval(days => ${days})) as events,
        (select count(*)::int from ${t} x where x.user_id = ${userId} and extract(isodow from x.completed_at) = d.dow and x.completed_at > now() - make_interval(days => ${days})) as completed
      from generate_series(1, 7) d(dow)`),
  );
  const categories = rowsOf<{ category: string; n: number }>(
    await db.execute(sql`select coalesce(category, 'Sans catégorie') as category, count(*)::int as n from ${t} where user_id = ${userId} and completed_at > now() - make_interval(days => ${days}) group by 1 order by 2 desc limit 8`),
  );

  // Observations factuelles : chaque phrase cite le chiffre qui la fonde, rien n'est extrapolé.
  const insights: string[] = [];
  const top = projects.find((p) => p.done_period > 0);
  if (top) insights.push(`Projet le plus actif : « ${top.name} » avec ${top.done_period} tâche(s) terminée(s) sur la période (${top.progress} % d'avancement).`);
  if (postponed.length) insights.push(`${postponed.length} tâche(s) ont été reportées au moins deux fois, dont « ${postponed[0].title} » (${postponed[0].postponed_count} reports).`);
  const busiest = [...weekday].sort((a, b) => b.events - a.events)[0];
  const names = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  if (busiest?.events) insights.push(`Jour le plus chargé en rendez-vous : le ${names[busiest.dow]} (${busiest.events} événement(s) sur la période).`);
  if (totals.overdue) insights.push(`${totals.overdue} tâche(s) ouverte(s) ont dépassé leur échéance : un point d'attention.`);
  if (totals.done_with_due) insights.push(`${Math.round((100 * totals.on_time) / totals.done_with_due)} % des tâches datées terminées l'ont été à temps (${totals.on_time}/${totals.done_with_due}).`);
  const half = Math.floor(series.length / 2);
  const a = series.slice(0, half).reduce((s, x) => s + x.completed, 0);
  const b = series.slice(half).reduce((s, x) => s + x.completed, 0);
  if (a + b >= 4 && b !== a) insights.push(`Tâches terminées : ${b} sur la seconde moitié de la période contre ${a} sur la première (${b > a ? "hausse" : "baisse"}).`);

  return {
    period,
    bucket,
    series: series.map((s) => ({ ...s, planned_hours: Math.round((s.events_minutes / 60) * 10) / 10 })),
    totals,
    projects,
    postponed,
    weekday,
    categories,
    insights,
  };
}
