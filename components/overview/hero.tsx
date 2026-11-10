"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Droplets, MapPin, Wind } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { useUI } from "@/components/shell/ui-context";
import { WeatherArt, type WeatherData } from "@/components/weather/weather-icon";

function greeting(d: Date) {
  const h = d.getHours();
  if (h < 5) return "Bonne nuit";
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}

/** Moment de la journée d'après le lever et le coucher réels du soleil (Open-Meteo), sinon d'après l'heure. */
function phaseOf(now: Date, w?: WeatherData): "dawn" | "day" | "dusk" | "night" {
  const min = (d: Date) => d.getHours() * 60 + d.getMinutes();
  const n = min(now);
  const rise = w ? min(new Date(w.today.sunrise)) : 7 * 60 + 30;
  const set = w ? min(new Date(w.today.sunset)) : 18 * 60;
  if (n < rise - 30 || n > set + 40) return "night";
  if (n < rise + 60) return "dawn";
  if (n > set - 60) return "dusk";
  return "day";
}

const round = (n: number) => Math.round(n);

/** Accueil : salutation, contexte réel, horloge et météo réelle sur un ciel qui suit l'heure et le temps qu'il fait. */
export function Hero({ context, className }: { context: string; className?: string }) {
  const { me } = useUI();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const weather = useQuery({ queryKey: ["weather"], queryFn: () => api.get<WeatherData>("/api/weather"), staleTime: 10 * 60_000, refetchInterval: 15 * 60_000, retry: 1 });
  const w = weather.data;
  const phase = now ? phaseOf(now, w) : "day";
  const icon = w?.current.icon ?? "sun";
  const grey = ["cloud", "fog", "rain", "drizzle", "snow", "storm"].includes(icon);
  const wet = ["rain", "drizzle", "storm"].includes(icon);

  return (
    <section className={cn("sky @container relative isolate flex min-h-[220px] overflow-hidden rounded-[20px] border border-line p-5 shadow-[var(--shadow-sm)] md:px-6", `sky-${phase}`, grey && "sky-grey", className)}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {phase === "night" && <div className="sky-stars absolute inset-0" />}
        {grey && (
          <>
            <div className="sky-cloud top-[-30px] right-[18%] h-24 w-72" />
            <div className="sky-cloud top-[40%] right-[-40px] h-20 w-64 [animation-delay:-12s]" />
          </>
        )}
        {wet && <div className="sky-rain absolute inset-0 opacity-70" />}
      </div>

      <div className="flex w-full flex-col gap-5 @min-[520px]:flex-row @min-[520px]:justify-between">
        <div className="flex min-w-0 flex-col text-[var(--sky-fg)]">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--sky-line)] bg-[var(--sky-glass)] px-2.5 py-1 text-[12px] font-medium text-[var(--sky-fg-2)] backdrop-blur-sm">
            <span className="size-1.5 rounded-full bg-success" />
            <span className="first-letter:uppercase">{now?.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) ?? " "}</span>
          </span>
          <h2 className="mt-3 text-[26px] leading-[1.1] font-semibold tracking-[-0.025em] @min-[520px]:text-[30px]">
            {now ? greeting(now) : "Bonjour"}, {me.displayName.split(" ")[0]}
          </h2>
          <p className="mt-1.5 line-clamp-2 max-w-md text-[13.5px] leading-relaxed text-[var(--sky-fg-2)]">{context}</p>
          <p className="t-num mt-auto pt-4 text-[48px] leading-none font-semibold tracking-[-0.045em] @min-[520px]:text-[58px]" suppressHydrationWarning>
            {now ? now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : " "}
            <span className="ml-1.5 text-[18px] font-medium tracking-normal text-[var(--sky-fg-2)]">{now ? String(now.getSeconds()).padStart(2, "0") : ""}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-col justify-between gap-3 text-[var(--sky-fg)] @min-[520px]:w-[268px] @min-[520px]:items-end">
          {weather.isPending ? (
            <div className="h-20 w-48 animate-pulse rounded-[14px] bg-[var(--sky-glass)]" />
          ) : !w ? (
            <div className="rounded-[14px] border border-[var(--sky-line)] bg-[var(--sky-glass)] p-3.5 text-[12.5px] backdrop-blur-sm">
              <p className="font-medium">Météo indisponible</p>
              <p className="text-[var(--sky-fg-2)]">Nouvel essai automatique dans quelques minutes.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 @min-[520px]:flex-row-reverse">
                <WeatherArt icon={w.current.icon} night={!w.current.isDay} size={54} />
                <div className="@min-[520px]:text-right">
                  <p className="t-num text-[44px] leading-none font-semibold tracking-[-0.03em]">{round(w.current.temperature)}°</p>
                  <p className="mt-1 text-[13px] font-medium">
                    {w.current.label}
                    <span className="font-normal text-[var(--sky-fg-2)]"> · ressenti {round(w.current.feelsLike)}°</span>
                  </p>
                </div>
              </div>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--sky-fg-2)] @min-[520px]:justify-end">
                <span className="t-num">
                  ↑ {round(w.today.max)}° ↓ {round(w.today.min)}°
                </span>
                <Link href="/settings?s=general" className="inline-flex items-center gap-1 hover:text-[var(--sky-fg)]" title={w.isDefaultPlace ? "Ville par défaut — choisir la tienne" : "Changer de ville"}>
                  <MapPin className="size-3.5" />
                  {w.place}
                  {w.isDefaultPlace && <span className="underline underline-offset-2">choisir</span>}
                </Link>
                <span className="inline-flex items-center gap-1" title={`Vent ${round(w.current.wind)} km/h · pluie ${w.today.rain} %`}>
                  <Wind className="size-3.5" />
                  {round(w.current.wind)} km/h
                </span>
                <span className="inline-flex items-center gap-1">
                  <Droplets className="size-3.5" />
                  {w.today.rain} %
                </span>
              </p>
              <ol className="grid w-full grid-cols-5 gap-0.5 rounded-[14px] border border-[var(--sky-line)] bg-[var(--sky-glass)] p-1 backdrop-blur-md">
                {w.days.map((d, i) => (
                  <li key={d.date} className="flex flex-col items-center rounded-[10px] py-1" title={`${d.label} · pluie ${d.rain} %`}>
                    <span className="text-[11px] text-[var(--sky-fg-2)] capitalize">{i === 0 ? "Auj." : new Date(`${d.date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short" })}</span>
                    <WeatherArt icon={d.icon} size={18} />
                    <span className="t-num text-[11.5px] font-semibold">
                      {round(d.max)}°<span className="font-normal text-[var(--sky-fg-2)]"> {round(d.min)}°</span>
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
