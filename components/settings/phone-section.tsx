"use client";
import { useEffect, useState } from "react";
import { Bell, BellOff, Share, SquarePlus, Smartphone } from "lucide-react";
import { Card, Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from "@/lib/client/push";

/** Paramètres → Général : installer l'app sur l'iPhone et activer les notifications de ce téléphone. */
export function PhoneSection() {
  const { toast } = useToast();
  const [env, setEnv] = useState<{ ios: boolean; standalone: boolean; supported: boolean } | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setEnv({ ios: isIos(), standalone: isStandalone(), supported: pushSupported() });
    currentSubscription().then((s) => setOn(!!s && Notification.permission === "granted"));
  }, []);
  if (!env) return null;
  const needsInstall = env.ios && !env.standalone;

  const toggle = async () => {
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        setOn(false);
        toast({ kind: "success", title: "Notifications désactivées sur cet appareil" });
      } else {
        await enablePush();
        setOn(true);
        toast({ kind: "success", title: "Notifications activées", description: "Une notification d'essai vient d'être envoyée." });
      }
    } catch (e) {
      toast({ kind: "error", title: "Impossible d'activer les notifications", description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4 p-5">
      <div className="flex items-center gap-2">
        <h2 className="t-section">Application sur le téléphone</h2>
        {env.standalone && <Badge tone="success">Installée</Badge>}
      </div>
      <p className="t-sub mt-1 mb-4">Quiz du soir prêts et rappel à 18 h des devoirs pas encore faits pour le lendemain, directement sur ton téléphone.</p>
      {needsInstall ? (
        <ol className="flex flex-col gap-2.5 text-[13px]">
          <li className="flex items-center gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-raised text-[12px] font-semibold">1</span>
            Dans Safari, touche <Share className="inline size-4 text-accent" aria-label="Partager" /> en bas de l'écran.
          </li>
          <li className="flex items-center gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-raised text-[12px] font-semibold">2</span>
            Choisis <SquarePlus className="inline size-4" aria-hidden /> « Sur l'écran d'accueil », puis « Ajouter ».
          </li>
          <li className="flex items-center gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-raised text-[12px] font-semibold">3</span>
            Ouvre Basile OS depuis son icône et reviens ici pour activer les notifications.
          </li>
        </ol>
      ) : !env.supported ? (
        <p className="t-meta flex items-center gap-2">
          <Smartphone className="size-4" />
          Ce navigateur ne gère pas les notifications. Sur iPhone, ouvre le site dans Safari et installe-le sur l'écran d'accueil.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant={on ? "secondary" : "primary"} loading={busy} icon={on ? <BellOff className="size-4" /> : <Bell className="size-4" />} onClick={toggle}>
            {on ? "Désactiver sur cet appareil" : "Activer les notifications"}
          </Button>
          <span className="t-meta">{on ? "Activées sur cet appareil." : "Désactivées sur cet appareil."}</span>
        </div>
      )}
    </Card>
  );
}
