"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, CalendarDays, Lightbulb } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, addDays, startOfDay, formatTime, isoDate, pad2 } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/tabs";
import { EmptyState, Badge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";
import { useEvents } from "@/hooks/use-data";
import { useStatus } from "@/hooks/use-status";
import { EventDetail } from "./event-detail";
import type { CalendarEvent } from "@/types";

type View = "day" | "week" | "month" | "agenda";
const HOUR = 52; // px par heure
const START_H = 0;

function startOfWeek(d: Date) {
  const r = startOfDay(d);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

export function CalendarView() {
  const sp = useSearchParams();
  const router = useRouter();
  const [view, setView] = useState<View>(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "agenda" : "week"));
  const [cursor, setCursor] = useState(() => startOfDay());
  const eventId = sp.get("event");
  const { openCreate, askAssistant } = useUI();
  const { data: status } = useStatus();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const range = useMemo(() => {
    if (view === "day") return { from: cursor, to: addDays(cursor, 1) };
    if (view === "week") {
      const s = startOfWeek(cursor);
      return { from: s, to: addDays(s, 7) };
    }
    if (view === "month") {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const s = startOfWeek(first);
      return { from: s, to: addDays(s, 42) };
    }
    return { from: cursor, to: addDays(cursor, 30) };
  }, [view, cursor]);
  const { data, isLoading } = useEvents(range.from, range.to);
  const events = data?.items ?? [];

  const move = (dir: number) => {
    if (view === "day") setCursor(addDays(cursor, dir));
    else if (view === "week") setCursor(addDays(cursor, dir * 7));
    else if (view === "month") setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    else setCursor(addDays(cursor, dir * 30));
  };
  const open = (id: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (id) p.set("event", id);
    else p.delete("event");
    router.replace(`/calendar?${p}`, { scroll: false });
  };

  const reschedule = async (ev: CalendarEvent, start: Date) => {
    const dur = new Date(ev.endAt).getTime() - new Date(ev.startAt).getTime();
    const end = new Date(start.getTime() + dur);
    const key = ["events", range.from.toISOString(), range.to.toISOString()];
    qc.setQueryData<{ items: CalendarEvent[] }>(key, (d) => d && { items: d.items.map((x) => (x.id === ev.id ? { ...x, startAt: start.toISOString(), endAt: end.toISOString() } : x)) });
    try {
      await api.patch(`/api/events/${ev.id}`, { startAt: start.toISOString(), endAt: end.toISOString() });
      toast({ kind: "success", title: "Événement déplacé", description: `${ev.title} · ${start.toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` });
    } catch (e) {
      toast({ kind: "error", title: "Déplacement impossible", description: (e as Error).message });
    }
    qc.invalidateQueries({ queryKey: ["events"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const title =
    view === "month"
      ? cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
      : view === "day"
        ? cursor.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
        : `${range.from.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${addDays(range.to, -1).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;
  const calOn = status?.google.services.calendar.status === "connected";

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col px-4 py-5 md:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="t-title mr-2 capitalize">{title}</h1>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" onClick={() => move(-1)} aria-label="Précédent">
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCursor(startOfDay())}>
            Aujourd'hui
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => move(1)} aria-label="Suivant">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {calOn ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw className={syncing ? "size-3.5 animate-spin" : "size-3.5"} />}
              onClick={async () => {
                setSyncing(true);
                try {
                  await api.post("/api/integrations/google/sync", { service: "calendar" });
                  qc.invalidateQueries({ queryKey: ["events"] });
                } catch (e) {
                  toast({ kind: "error", title: "Synchronisation échouée", description: (e as Error).message });
                } finally {
                  setSyncing(false);
                }
              }}
            >
              Synchroniser
            </Button>
          ) : (
            <Badge>Google Calendar non connecté — calendrier local</Badge>
          )}
          <Button size="sm" variant="ghost" icon={<Lightbulb className="size-3.5 text-fg-3" />} onClick={() => askAssistant("Planifie une séance de travail de deux heures demain après-midi : trouve les meilleurs créneaux libres et propose-les.")}>
            Planifier
          </Button>
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "day", label: "Jour" },
              { value: "week", label: "Semaine" },
              { value: "month", label: "Mois" },
              { value: "agenda", label: "Agenda" },
            ]}
          />
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => openCreate("event", { date: isoDate(cursor), endDate: isoDate(cursor) })}>
            Événement
          </Button>
        </div>
      </div>

      {view === "month" ? (
        <MonthGrid from={range.from} cursor={cursor} events={events} onOpen={open} onPickDay={(d) => (setCursor(d), setView("day"))} />
      ) : view === "agenda" ? (
        <Agenda events={events} loading={isLoading} onOpen={open} />
      ) : (
        <TimeGrid days={view === "day" ? [cursor] : Array.from({ length: 7 }, (_, i) => addDays(range.from, i))} events={events} onOpen={open} onMove={reschedule} onCreate={(d) => openCreate("event", { date: isoDate(d), endDate: isoDate(d), start: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`, end: `${pad2(d.getHours() + 1)}:${pad2(d.getMinutes())}` })} />
      )}

      <EventDetail id={eventId} onClose={() => open(null)} />
    </div>
  );
}

function eventColor(e: CalendarEvent) {
  return e.color ?? "var(--accent)";
}

/** Grille horaire jour/semaine avec déplacement des événements par glisser-déposer (pas de 15 min). */
function TimeGrid({ days, events, onOpen, onMove, onCreate }: { days: Date[]; events: CalendarEvent[]; onOpen: (id: string) => void; onMove: (e: CalendarEvent, start: Date) => void; onCreate: (d: Date) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const today = isoDate();
  const now = new Date();
  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);

  const scrolled = useRef(false);
  const setScroller = (el: HTMLDivElement | null) => {
    scroller.current = el;
    if (el && !scrolled.current) {
      el.scrollTop = 7.5 * HOUR;
      scrolled.current = true;
    }
  };

  const startDrag = (ev: CalendarEvent, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const ox = e.clientX;
    const oy = e.clientY;
    let moved = false;
    const colW = (gridRef.current?.getBoundingClientRect().width ?? 700) / days.length;
    const onMoveP = (m: PointerEvent) => {
      const dx = m.clientX - ox;
      const dy = m.clientY - oy;
      if (!moved && Math.hypot(dx, dy) < 6) return; // hystérésis avant de commencer le glissement
      moved = true;
      setDrag({ id: ev.id, dx: Math.round(dx / colW) * colW, dy: Math.round(dy / (HOUR / 4)) * (HOUR / 4) });
    };
    const finish = (up: PointerEvent) => {
      el.removeEventListener("pointermove", onMoveP);
      el.removeEventListener("pointerup", finish);
      el.removeEventListener("pointercancel", finish);
      setDrag(null);
      if (!moved) return onOpen(ev.id);
      if (up.type === "pointercancel") return;
      const dayShift = Math.round((up.clientX - ox) / colW);
      const minShift = Math.round((up.clientY - oy) / (HOUR / 4)) * 15;
      if (!dayShift && !minShift) return;
      const s = new Date(ev.startAt);
      s.setDate(s.getDate() + dayShift);
      s.setMinutes(s.getMinutes() + minShift);
      onMove(ev, s);
    };
    el.addEventListener("pointermove", onMoveP);
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
  };

  return (
    <div className="surface flex min-h-0 flex-col overflow-hidden">
      <div className="flex border-b border-line-soft">
        <div className="w-14 shrink-0" />
        {days.map((d) => (
          <div key={d.toISOString()} className={cn("flex-1 border-l border-line-soft px-2 py-2 text-center", isoDate(d) === today && "text-accent")}>
            <div className="t-label">{d.toLocaleDateString("fr-FR", { weekday: "short" })}</div>
            <div className="t-num text-[18px] font-semibold">{d.getDate()}</div>
            {allDay
              .filter((e) => isoDate(new Date(e.startAt)) <= isoDate(d) && new Date(e.endAt) > d)
              .map((e) => (
                <button key={e.id} onClick={() => onOpen(e.id)} className="mt-1 block w-full truncate rounded-[5px] px-1.5 py-0.5 text-left text-[11.5px] text-white" style={{ background: eventColor(e) }}>
                  {e.title}
                </button>
              ))}
          </div>
        ))}
      </div>
      <div ref={setScroller} className="relative h-[calc(100dvh-282px)] min-h-[420px] overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * HOUR }}>
          <div className="w-14 shrink-0">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="t-meta relative pr-2 text-right" style={{ height: HOUR }}>
                <span className="absolute -top-2 right-2">{h ? `${pad2(h)}:00` : ""}</span>
              </div>
            ))}
          </div>
          <div ref={gridRef} className="relative flex flex-1">
            {days.map((d) => {
              const dayEvents = timed.filter((e) => {
                const s = new Date(e.startAt);
                return s >= d && s < addDays(d, 1);
              });
              const lanes = layoutLanes(dayEvents);
              return (
                <div
                  key={d.toISOString()}
                  className="relative flex-1 border-l border-line-soft"
                  onDoubleClick={(e) => {
                    const y = e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;
                    const m = Math.floor(((y / HOUR) * 60) / 15) * 15;
                    const at = new Date(d);
                    at.setMinutes(START_H * 60 + m);
                    onCreate(at);
                  }}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="border-b border-line-soft/60" style={{ height: HOUR }} />
                  ))}
                  {isoDate(d) === today && <div className="absolute inset-x-0 z-10 h-px bg-danger" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR }} />}
                  {dayEvents.map((ev) => {
                    const s = new Date(ev.startAt);
                    const e = new Date(ev.endAt);
                    const top = ((s.getHours() * 60 + s.getMinutes()) / 60) * HOUR;
                    const height = Math.max(20, ((e.getTime() - s.getTime()) / 3600_000) * HOUR - 2);
                    const lane = lanes.get(ev.id) ?? { i: 0, n: 1 };
                    const dragging = drag?.id === ev.id;
                    return (
                      <div
                        key={ev.id}
                        onPointerDown={(p) => startDrag(ev, p)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(k) => k.key === "Enter" && onOpen(ev.id)}
                        className={cn("absolute cursor-grab touch-none overflow-hidden rounded-[7px] border-l-[3px] px-1.5 py-1 text-[11.5px] leading-tight select-none active:cursor-grabbing", dragging ? "z-20 opacity-90 shadow-[var(--shadow-lg)]" : "z-[5] transition-transform")}
                        style={{
                          top,
                          height,
                          left: `calc(${(lane.i / lane.n) * 100}% + 2px)`,
                          width: `calc(${100 / lane.n}% - 4px)`,
                          background: `color-mix(in srgb, ${eventColor(ev)} 20%, var(--card))`,
                          borderColor: eventColor(ev),
                          transform: dragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
                        }}
                      >
                        <div className="truncate font-medium text-fg">{ev.title}</div>
                        {height > 32 && (
                          <div className="truncate text-fg-2">
                            {formatTime(s)} – {formatTime(e)}
                            {ev.location ? ` · ${ev.location}` : ""}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Répartit les événements qui se chevauchent sur des colonnes. */
function layoutLanes(evs: CalendarEvent[]) {
  const sorted = [...evs].sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  const out = new Map<string, { i: number; n: number }>();
  let group: CalendarEvent[] = [];
  let groupEnd = 0;
  const flush = () => {
    const lanes: number[] = [];
    for (const e of group) {
      const s = +new Date(e.startAt);
      let i = lanes.findIndex((end) => end <= s);
      if (i < 0) i = lanes.push(0) - 1;
      lanes[i] = +new Date(e.endAt);
      out.set(e.id, { i, n: 0 });
    }
    for (const e of group) out.get(e.id)!.n = lanes.length;
    group = [];
  };
  for (const e of sorted) {
    if (group.length && +new Date(e.startAt) >= groupEnd) flush();
    group.push(e);
    groupEnd = Math.max(groupEnd, +new Date(e.endAt));
  }
  flush();
  return out;
}

function MonthGrid({ from, cursor, events, onOpen, onPickDay }: { from: Date; cursor: Date; events: CalendarEvent[]; onOpen: (id: string) => void; onPickDay: (d: Date) => void }) {
  const today = isoDate();
  return (
    <div className="surface overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line-soft">
        {["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."].map((d) => (
          <div key={d} className="t-label px-2 py-2 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: 42 }, (_, i) => {
          const d = addDays(from, i);
          const evs = events.filter((e) => isoDate(new Date(e.startAt)) === isoDate(d) || (e.allDay && new Date(e.startAt) <= d && new Date(e.endAt) > d));
          return (
            <div key={i} className={cn("min-h-[96px] border-b border-l border-line-soft p-1.5", d.getMonth() !== cursor.getMonth() && "bg-bg-2/40 text-fg-3")}>
              <button onClick={() => onPickDay(d)} className={cn("t-num mb-1 grid size-6 place-items-center rounded-full text-[12px]", isoDate(d) === today && "bg-accent text-white")}>
                {d.getDate()}
              </button>
              {evs.slice(0, 3).map((e) => (
                <button key={e.id} onClick={() => onOpen(e.id)} className="mb-0.5 flex w-full items-center gap-1 truncate rounded-[4px] px-1 text-left text-[11px] hover:bg-raised">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: eventColor(e) }} />
                  <span className="truncate">{e.allDay ? "" : `${formatTime(e.startAt)} `}{e.title}</span>
                </button>
              ))}
              {evs.length > 3 && <button onClick={() => onPickDay(d)} className="t-meta px-1">+{evs.length - 3}</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Agenda({ events, loading, onOpen }: { events: CalendarEvent[]; loading: boolean; onOpen: (id: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const k = isoDate(new Date(e.startAt));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m.entries()];
  }, [events]);
  if (!loading && !groups.length) return <div className="surface"><EmptyState icon={<CalendarDays className="size-5" />} title="Aucun événement sur 30 jours" /></div>;
  return (
    <div className="surface divide-y divide-line-soft">
      {groups.map(([day, evs]) => (
        <div key={day} className="flex gap-4 px-4 py-3">
          <div className="w-20 shrink-0">
            <div className="t-label">{new Date(day + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short" })}</div>
            <div className="t-num text-[20px] font-semibold">{new Date(day + "T00:00:00").getDate()}</div>
            <div className="t-meta">{new Date(day + "T00:00:00").toLocaleDateString("fr-FR", { month: "short" })}</div>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            {evs.map((e) => (
              <button key={e.id} onClick={() => onOpen(e.id)} className="flex items-center gap-3 rounded-[8px] px-2 py-2 text-left hover:bg-raised/60">
                <span className="h-8 w-[3px] rounded-full" style={{ background: eventColor(e) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{e.title}</span>
                  <span className="t-meta">
                    {e.allDay ? "Toute la journée" : `${formatTime(e.startAt)} – ${formatTime(e.endAt)}`}
                    {e.location ? ` · ${e.location}` : ""}
                  </span>
                </span>
                {e.source === "google" && <Badge>Google</Badge>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
