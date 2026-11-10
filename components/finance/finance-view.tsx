"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, Plus, TrendingUp, TrendingDown, PiggyBank, Trash2, ChevronLeft, ChevronRight, Lightbulb, Target } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn, formatMoney, isoDate } from "@/lib/utils";
import { PageHeader, Card, CardHeader, EmptyState, Progress, Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/tabs";
import { BarChart } from "@/components/charts/charts";
import { useToast } from "@/components/ui/toast";
import { useUI } from "@/components/shell/ui-context";

type Report = {
  month: string;
  income: number;
  expense: number;
  balance: number;
  byCategory: { kind: string; category: string; total: number; n: number }[];
  budgets: { id: string; category: string; monthlyAmount: number; spent: number; ratio: number }[];
  goals: { id: string; name: string; targetAmount: number; currentAmount: number; dueDate: string | null }[];
  series: { month: string; income: number; expense: number }[];
};
type Tx = { id: string; kind: "income" | "expense"; amount: string; category: string; description: string; date: string };

const DEFAULT_CATS = { expense: ["Logement", "Alimentation", "Transport", "Abonnements", "Santé", "Loisirs", "Shopping", "Impôts", "Autre"], income: ["Salaire", "Freelance", "Remboursement", "Investissements", "Autre"] };

export function FinanceView() {
  const sp = useSearchParams();
  const [month, setMonth] = useState(() => isoDate().slice(0, 7));
  const [txOpen, setTxOpen] = useState(!!sp.get("new"));
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const { askAssistant } = useUI();
  const { data: r } = useQuery({ queryKey: ["finance-report", month], queryFn: () => api.get<Report>(`/api/finance/report?month=${month}`) });
  const last = new Date(`${month}-01T00:00:00`);
  const end = new Date(last.getFullYear(), last.getMonth() + 1, 0);
  const { data: txs } = useQuery({ queryKey: ["finance-tx", month], queryFn: () => api.get<{ items: Tx[] }>(`/api/finance/transactions?from=${month}-01&to=${isoDate(end)}`) });
  const shift = (n: number) => {
    const d = new Date(`${month}-01T00:00:00`);
    d.setMonth(d.getMonth() + n);
    setMonth(isoDate(d).slice(0, 7));
  };
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = () => ["finance-report", "finance-tx"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const empty = r && !r.income && !r.expense && !txs?.items.length;

  return (
    <div className="mx-auto max-w-[1600px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader
        title="Finances"
        description="Suivi manuel : aucune connexion bancaire, aucun solde ni transaction n'est inventé."
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<Lightbulb className="size-3.5 text-fg-3" />} onClick={() => askAssistant(`Résume mes finances de ${new Date(month + "-01").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })} à partir des transactions saisies : revenus, dépenses par catégorie, budgets dépassés. Ne suppose aucune donnée absente. Données : ${JSON.stringify({ income: r?.income, expense: r?.expense, byCategory: r?.byCategory, budgets: r?.budgets })}`)}>
              Synthèse
            </Button>
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setTxOpen(true)}>
              Transaction
            </Button>
          </>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Button size="icon-sm" variant="ghost" onClick={() => shift(-1)} aria-label="Mois précédent">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="t-section w-40 text-center capitalize">{new Date(`${month}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</span>
        <Button size="icon-sm" variant="ghost" onClick={() => shift(1)} aria-label="Mois suivant">
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {empty && (
        <div className="surface mb-4">
          <EmptyState icon={<Wallet className="size-5" />} title="Aucune transaction ce mois-ci" description="Saisis tes revenus et dépenses : les rapports et graphiques seront calculés à partir de ces données uniquement." action={<Button variant="primary" onClick={() => setTxOpen(true)}>Ajouter une transaction</Button>} />
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { l: "Revenus", v: r?.income ?? 0, i: <TrendingUp />, c: "text-success" },
          { l: "Dépenses", v: r?.expense ?? 0, i: <TrendingDown />, c: "text-danger" },
          { l: "Solde du mois", v: r?.balance ?? 0, i: <Wallet />, c: (r?.balance ?? 0) >= 0 ? "text-fg" : "text-danger" },
        ].map((s) => (
          <Card key={s.l} className="p-4">
            <div className="flex items-center justify-between">
              <span className="t-label">{s.l}</span>
              <span className="text-fg-3 [&>svg]:size-4">{s.i}</span>
            </div>
            <p className={cn("t-num mt-3 text-[26px] font-semibold", s.c)}>{formatMoney(s.v)}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8">
          <CardHeader title="Évolution sur 12 mois" />
          <div className="px-4 pb-4">
            <BarChart
              title="Revenus et dépenses par mois"
              data={(r?.series ?? []).map((s) => ({ label: new Date(s.month + "-01").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }), values: [s.income, s.expense] }))}
              series={[
                { name: "Revenus", color: "var(--success)" },
                { name: "Dépenses", color: "var(--danger)" },
              ]}
              format={(v) => formatMoney(v)}
            />
          </div>
        </Card>
        <Card className="lg:col-span-4">
          <CardHeader title="Dépenses par catégorie" />
          <div className="flex flex-col gap-2.5 px-4 pb-4">
            {(r?.byCategory.filter((c) => c.kind === "expense") ?? []).length === 0 && <p className="t-meta">Aucune dépense.</p>}
            {r?.byCategory
              .filter((c) => c.kind === "expense")
              .map((c) => (
                <div key={c.category}>
                  <div className="mb-1 flex justify-between text-[13px]">
                    <span>{c.category}</span>
                    <span className="t-num">{formatMoney(c.total)}</span>
                  </div>
                  <Progress value={(c.total / Math.max(1, r.expense)) * 100} color="var(--danger)" />
                </div>
              ))}
          </div>
        </Card>
        <Card className="lg:col-span-6">
          <CardHeader title="Budgets mensuels" action={<Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setBudgetOpen(true)}>Budget</Button>} />
          <div className="flex flex-col gap-3 px-4 pb-4">
            {!r?.budgets.length && <p className="t-meta">Aucun budget défini.</p>}
            {r?.budgets.map((b) => (
              <div key={b.id} className="group">
                <div className="mb-1 flex items-center gap-2 text-[13px]">
                  <span className="flex-1">{b.category}</span>
                  {b.ratio > 1 && <Badge tone="danger">Dépassé</Badge>}
                  <span className="t-num">
                    {formatMoney(b.spent)} / {formatMoney(b.monthlyAmount)}
                  </span>
                  <button className="text-fg-3 opacity-0 group-hover:opacity-100 hover:text-danger" onClick={async () => (await api.del(`/api/finance/budgets/${b.id}`), refresh())} aria-label="Supprimer le budget">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <Progress value={b.ratio * 100} color={b.ratio > 1 ? "var(--danger)" : b.ratio > 0.8 ? "var(--warning)" : "var(--success)"} />
              </div>
            ))}
          </div>
        </Card>
        <Card className="lg:col-span-6">
          <CardHeader title="Objectifs d'épargne" icon={<PiggyBank className="size-4" />} action={<Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setGoalOpen(true)}>Objectif</Button>} />
          <div className="flex flex-col gap-3 px-4 pb-4">
            {!r?.goals.length && <p className="t-meta">Aucun objectif.</p>}
            {r?.goals.map((g) => (
              <div key={g.id} className="group">
                <div className="mb-1 flex items-center gap-2 text-[13px]">
                  <Target className="size-3.5 text-fg-3" />
                  <span className="flex-1">{g.name}</span>
                  <span className="t-num">
                    {formatMoney(g.currentAmount)} / {formatMoney(g.targetAmount)}
                  </span>
                  <button
                    className="t-meta opacity-0 group-hover:opacity-100 hover:text-fg"
                    onClick={async () => {
                      const v = window.prompt("Montant épargné actuel (€)", String(g.currentAmount));
                      if (v === null || Number.isNaN(Number(v))) return;
                      await api.patch(`/api/finance/goals/${g.id}`, { currentAmount: Number(v) }).catch((e) => toast({ kind: "error", title: "Erreur", description: e.message }));
                      refresh();
                    }}
                  >
                    mettre à jour
                  </button>
                  <button className="text-fg-3 opacity-0 group-hover:opacity-100 hover:text-danger" onClick={async () => (await api.del(`/api/finance/goals/${g.id}`), refresh())} aria-label="Supprimer l'objectif">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <Progress value={(g.currentAmount / Math.max(1, g.targetAmount)) * 100} color="var(--accent-2)" />
                {g.dueDate && <p className="t-meta mt-1">Échéance {new Date(g.dueDate).toLocaleDateString("fr-FR")}</p>}
              </div>
            ))}
          </div>
        </Card>
        <Card className="lg:col-span-12">
          <CardHeader title="Transactions du mois" subtitle={`${txs?.items.length ?? 0} opération(s)`} />
          <div className="px-2 pb-2">
            {txs?.items.map((t) => (
              <div key={t.id} className="group flex items-center gap-3 rounded-[8px] px-2 py-2 hover:bg-raised/50">
                <span className="t-meta w-20">{new Date(t.date + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px]">{t.description || t.category}</span>
                  <span className="t-meta">{t.category}</span>
                </span>
                <span className={cn("t-num text-[13.5px] font-medium", t.kind === "income" ? "text-success" : "text-fg")}>
                  {t.kind === "income" ? "+" : "−"}
                  {formatMoney(t.amount)}
                </span>
                <button className="text-fg-3 opacity-0 group-hover:opacity-100 hover:text-danger" onClick={async () => (await api.del(`/api/finance/transactions/${t.id}`), refresh())} aria-label="Supprimer">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <TxDialog open={txOpen} onClose={() => setTxOpen(false)} onSaved={refresh} />
      <Dialog open={budgetOpen} onClose={() => setBudgetOpen(false)} title="Budget mensuel" size="sm">
        <SimpleForm
          fields={[
            { k: "category", l: "Catégorie", options: DEFAULT_CATS.expense },
            { k: "monthlyAmount", l: "Montant mensuel (€)", type: "number" },
          ]}
          onSubmit={async (v) => {
            await api.post("/api/finance/budgets", v);
            refresh();
            setBudgetOpen(false);
          }}
        />
      </Dialog>
      <Dialog open={goalOpen} onClose={() => setGoalOpen(false)} title="Objectif d'épargne" size="sm">
        <SimpleForm
          fields={[
            { k: "name", l: "Nom" },
            { k: "targetAmount", l: "Montant cible (€)", type: "number" },
            { k: "currentAmount", l: "Déjà épargné (€)", type: "number" },
            { k: "dueDate", l: "Échéance", type: "date" },
          ]}
          onSubmit={async (v) => {
            await api.post("/api/finance/goals", { ...v, dueDate: v.dueDate || null, currentAmount: v.currentAmount || 0 });
            refresh();
            setGoalOpen(false);
          }}
        />
      </Dialog>
    </div>
  );
}

function TxDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [v, setV] = useState({ amount: "", category: "Alimentation", description: "", date: isoDate() });
  const { toast } = useToast();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nouvelle transaction"
      footer={
        <Button
          variant="primary"
          disabled={!(Number(v.amount) > 0)}
          onClick={async () => {
            try {
              await api.post("/api/finance/transactions", { ...v, kind, amount: Number(v.amount.replace(",", ".")) });
              onSaved();
              onClose();
              setV({ ...v, amount: "", description: "" });
              toast({ kind: "success", title: "Transaction enregistrée" });
            } catch (e) {
              toast({ kind: "error", title: "Enregistrement impossible", description: (e as Error).message });
            }
          }}
        >
          Enregistrer
        </Button>
      }
    >
      <Segmented className="mb-3" value={kind} onChange={(k) => (setKind(k), setV({ ...v, category: DEFAULT_CATS[k][0] }))} options={[{ value: "expense", label: "Dépense" }, { value: "income", label: "Revenu" }]} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Montant (€)">
          <Input inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder="0,00" data-autofocus />
        </Field>
        <Field label="Date">
          <Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </Field>
        <Field label="Catégorie">
          <Input list="fin-cats" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} />
          <datalist id="fin-cats">
            {DEFAULT_CATS[kind].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Description">
          <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

function SimpleForm({ fields, onSubmit }: { fields: { k: string; l: string; type?: string; options?: string[] }[]; onSubmit: (v: Record<string, string | number>) => Promise<void> }) {
  const [v, setV] = useState<Record<string, string>>({});
  const { toast } = useToast();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await onSubmit(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fields.find((f) => f.k === k)?.type === "number" ? Number(x.replace(",", ".")) : x])));
          setV({});
        } catch (err) {
          toast({ kind: "error", title: "Enregistrement impossible", description: (err as Error).message });
        }
      }}
    >
      {fields.map((f) => (
        <Field key={f.k} label={f.l}>
          {f.options ? (
            <Input list={`opt-${f.k}`} value={v[f.k] ?? ""} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} />
          ) : (
            <Input type={f.type === "number" ? "text" : f.type} inputMode={f.type === "number" ? "decimal" : undefined} value={v[f.k] ?? ""} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} />
          )}
          {f.options && (
            <datalist id={`opt-${f.k}`}>
              {f.options.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          )}
        </Field>
      ))}
      <Button type="submit" variant="primary" className="self-end">
        Enregistrer
      </Button>
    </form>
  );
}

