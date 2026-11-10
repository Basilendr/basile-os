import { z } from "zod";
import { eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { schema } from "@/lib/db";
import { defaultPlace, getWeather } from "@/services/weather";

export const GET = route({ rate: [30, 60_000] }, async ({ db, user }) => {
  const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  const custom = p?.weatherLat != null && p?.weatherLon != null;
  const place = custom ? { name: p!.weatherCity ?? "Ma position", lat: p!.weatherLat!, lon: p!.weatherLon! } : defaultPlace(p?.timezone ?? "Europe/Paris");
  return { ...(await getWeather(place.lat, place.lon, place.name)), isDefaultPlace: !custom };
});

/** Choix de la ville (depuis la recherche) ou de la position du navigateur. */
export const PUT = route({ body: z.object({ city: z.string().trim().min(1).max(120), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }) }, async ({ db, user, body }) => {
  await db.update(schema.profiles).set({ weatherCity: body.city, weatherLat: body.lat, weatherLon: body.lon }).where(eq(schema.profiles.userId, user.id));
  return { ok: true };
});
