/** Démarre l'ordonnanceur et le moteur d'automatisation dans le processus serveur Node.js. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("./services/scheduler");
  await import("./services/automations/engine").catch(() => null);
  startScheduler();
}
