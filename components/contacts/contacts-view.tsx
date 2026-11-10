"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Search, Star, Mail, Phone, Building2, Trash2, Pencil, CalendarDays, Link2 } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { relativeTime } from "@/lib/utils";
import { PageHeader, EmptyState, Avatar, Badge, Skeleton } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Select } from "@/components/ui/input";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useProjects } from "@/hooks/use-data";
import { useStatus } from "@/hooks/use-status";

type Contact = { id: string; name: string; email: string | null; phone: string | null; company: string | null; jobTitle: string | null; notes: string; tags: string[]; favorite: boolean; updatedAt: string };
type Detail = Contact & { emails: { id: string; subject: string; date: string; labels: string[] }[]; events: { id: string; title: string; startAt: string }[]; links: { type: string; id: string; title: string; href: string; linkId: string }[] };

export function ContactsView() {
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [fav, setFav] = useState(false);
  const [edit, setEdit] = useState<Partial<Contact> | null>(sp.get("new") ? {} : null);
  const openId = sp.get("contact");
  const { data, isLoading } = useQuery({ queryKey: ["contacts", q, tag, fav], queryFn: () => api.get<{ items: Contact[] }>(`/api/contacts${qs({ q, tag, favorite: fav ? "1" : undefined })}`) });
  const { data: status } = useStatus();
  const tags = useMemo(() => [...new Set((data?.items ?? []).flatMap((c) => c.tags))].sort(), [data]);
  const open = (id: string | null) => router.replace(id ? `/contacts?contact=${id}` : "/contacts", { scroll: false });

  return (
    <div className="mx-auto max-w-[1100px] px-1 pt-1 pb-10 md:px-3 md:pt-2">
      <PageHeader
        title="Contacts"
        description={`${data?.items.length ?? 0} contact(s)${status?.google.services.contacts.status === "connected" ? " · Google Contacts autorisé (import non encore implémenté)" : ""}`}
        actions={
          <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({})}>
            Nouveau contact
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, email, entreprise, téléphone…" className="pl-8" />
        </div>
        <Select value={tag} onChange={(e) => setTag(e.target.value)} className="w-auto" aria-label="Étiquette">
          <option value="">Toutes les étiquettes</option>
          {tags.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <Button variant={fav ? "secondary" : "ghost"} size="sm" icon={<Star className={fav ? "size-3.5 fill-warning text-warning" : "size-3.5"} />} onClick={() => setFav((f) => !f)}>
          Favoris
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-40 rounded-[12px]" />
      ) : !data?.items.length ? (
        <div className="surface">
          <EmptyState icon={<Users className="size-5" />} title="Aucun contact" description="Ajoute tes contacts : ils seront reliés à tes emails, rendez-vous et projets." action={<Button variant="primary" onClick={() => setEdit({})}>Ajouter un contact</Button>} />
        </div>
      ) : (
        <div className="surface divide-y divide-line-soft overflow-hidden">
          {data.items.map((c) => (
            <button key={c.id} onClick={() => open(c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised/40">
              <Avatar name={c.name} size={34} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
                  {c.name}
                  {c.favorite && <Star className="size-3 fill-warning text-warning" />}
                </span>
                <span className="t-meta block truncate">{[c.jobTitle, c.company, c.email].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="hidden gap-1 sm:flex">
                {c.tags.slice(0, 3).map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </span>
            </button>
          ))}
        </div>
      )}
      {edit && <ContactForm initial={edit} onClose={() => (setEdit(null), sp.get("new") && router.replace("/contacts"))} />}
      <ContactDetail id={openId} onClose={() => open(null)} onEdit={(c) => setEdit(c)} />
    </div>
  );
}

function ContactForm({ initial, onClose }: { initial: Partial<Contact>; onClose: () => void }) {
  const [v, setV] = useState({ name: "", email: "", phone: "", company: "", jobTitle: "", notes: "", tags: "", favorite: false, ...initial, tagsText: (initial.tags ?? []).join(", ") });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const qc = useQueryClient();
  const { toast } = useToast();
  const save = async () => {
    const body = { name: v.name, email: v.email || null, phone: v.phone || null, company: v.company || null, jobTitle: v.jobTitle || null, notes: v.notes, favorite: v.favorite, tags: v.tagsText.split(",").map((t) => t.trim()).filter(Boolean) };
    try {
      if (initial.id) await api.patch(`/api/contacts/${initial.id}`, body);
      else await api.post("/api/contacts", body);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact"] });
      toast({ kind: "success", title: initial.id ? "Contact mis à jour" : "Contact ajouté" });
      onClose();
    } catch (e) {
      setErrors((e as { issues?: Record<string, string[]> }).issues ?? {});
      toast({ kind: "error", title: "Enregistrement impossible", description: (e as Error).message });
    }
  };
  return (
    <Dialog open onClose={onClose} title={initial.id ? "Modifier le contact" : "Nouveau contact"} size="lg" footer={<Button variant="primary" disabled={!v.name.trim()} onClick={save}>Enregistrer</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom" error={errors.name?.[0]}>
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} data-autofocus />
        </Field>
        <Field label="Email" error={errors.email?.[0]}>
          <Input type="email" value={v.email ?? ""} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
        <Field label="Téléphone">
          <Input type="tel" value={v.phone ?? ""} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </Field>
        <Field label="Entreprise">
          <Input value={v.company ?? ""} onChange={(e) => setV({ ...v, company: e.target.value })} />
        </Field>
        <Field label="Poste">
          <Input value={v.jobTitle ?? ""} onChange={(e) => setV({ ...v, jobTitle: e.target.value })} />
        </Field>
        <Field label="Étiquettes" hint="Séparées par des virgules">
          <Input value={v.tagsText} onChange={(e) => setV({ ...v, tagsText: e.target.value })} placeholder="client, partenaire" />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} rows={4} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={v.favorite} onChange={(e) => setV({ ...v, favorite: e.target.checked })} /> Favori
        </label>
      </div>
    </Dialog>
  );
}

function ContactDetail({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (c: Contact) => void }) {
  const { data: c } = useQuery({ queryKey: ["contact", id], queryFn: () => api.get<Detail>(`/api/contacts/${id}`), enabled: !!id });
  const { data: projects } = useProjects();
  const [del, setDel] = useState(false);
  const [linkProject, setLinkProject] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();
  useEffect(() => setLinkProject(""), [id]);
  return (
    <Sheet
      open={!!id}
      onClose={onClose}
      title="Contact"
      actions={
        c && (
          <>
            <Button size="icon-sm" variant="ghost" onClick={() => onEdit(c)} aria-label="Modifier">
              <Pencil className="size-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setDel(true)} aria-label="Supprimer">
              <Trash2 className="size-4" />
            </Button>
          </>
        )
      }
    >
      {c && (
        <div className="flex flex-col gap-5 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={c.name} size={52} />
            <div>
              <h2 className="t-title">{c.name}</h2>
              <p className="t-sub">{[c.jobTitle, c.company].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 text-[13.5px]">
            {c.email && (
              <a href={`/inbox?compose=1`} className="flex items-center gap-2 text-fg-2 hover:text-fg">
                <Mail className="size-4 text-fg-3" /> {c.email}
              </a>
            )}
            {c.phone && (
              <a href={`tel:${c.phone}`} className="flex items-center gap-2 text-fg-2 hover:text-fg">
                <Phone className="size-4 text-fg-3" /> {c.phone}
              </a>
            )}
            {c.company && (
              <span className="flex items-center gap-2 text-fg-2">
                <Building2 className="size-4 text-fg-3" /> {c.company}
              </span>
            )}
          </div>
          {c.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {c.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          )}
          {c.notes && <p className="rounded-[9px] border border-line-soft bg-bg-2 p-3 text-[13px] whitespace-pre-wrap text-fg-2">{c.notes}</p>}
          <section>
            <p className="t-label mb-2">Projets associés</p>
            {c.links.filter((l) => l.type === "project").map((l) => (
              <div key={l.linkId} className="flex items-center gap-2 py-1">
                <Link href={l.href} className="flex-1 text-[13px] text-accent">
                  {l.title}
                </Link>
                <button
                  className="t-meta hover:text-danger"
                  onClick={async () => {
                    await api.del(`/api/brain/links/${l.linkId}`);
                    qc.invalidateQueries({ queryKey: ["contact", id] });
                  }}
                >
                  retirer
                </button>
              </div>
            ))}
            <div className="mt-1 flex gap-2">
              <Select value={linkProject} onChange={(e) => setLinkProject(e.target.value)} className="h-8">
                <option value="">Associer à un projet…</option>
                {projects?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                icon={<Link2 className="size-3.5" />}
                disabled={!linkProject}
                onClick={async () => {
                  try {
                    await api.post("/api/brain/links", { fromType: "contact", fromId: c.id, toType: "project", toId: linkProject, relation: "contact" });
                    qc.invalidateQueries({ queryKey: ["contact", id] });
                    setLinkProject("");
                  } catch (e) {
                    toast({ kind: "error", title: "Association impossible", description: (e as Error).message });
                  }
                }}
              >
                Associer
              </Button>
            </div>
          </section>
          <section>
            <p className="t-label mb-2">Historique des interactions</p>
            {!c.emails.length && !c.events.length ? (
              <p className="t-meta">Aucun email ni rendez-vous trouvé avec ce contact{c.email ? "" : " (ajoute son adresse email)"}.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {[...c.emails.map((m) => ({ k: `m${m.id}`, icon: <Mail className="size-3.5" />, title: m.subject || "(sans objet)", date: m.date, href: `/inbox?message=${m.id}`, sub: m.labels.includes("SENT") ? "envoyé" : "reçu" })), ...c.events.map((e) => ({ k: `e${e.id}`, icon: <CalendarDays className="size-3.5" />, title: e.title, date: e.startAt, href: `/calendar?event=${e.id}`, sub: "rendez-vous" }))]
                  .sort((a, b) => +new Date(b.date) - +new Date(a.date))
                  .map((x) => (
                    <Link key={x.k} href={x.href} className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-[13px] hover:bg-raised">
                      <span className="text-fg-3">{x.icon}</span>
                      <span className="flex-1 truncate">{x.title}</span>
                      <span className="t-meta">
                        {x.sub} · {relativeTime(x.date)}
                      </span>
                    </Link>
                  ))}
              </div>
            )}
          </section>
        </div>
      )}
      <ConfirmDialog
        open={del}
        onClose={() => setDel(false)}
        danger
        title="Supprimer ce contact ?"
        confirmLabel="Supprimer"
        onConfirm={async () => {
          await api.del(`/api/contacts/${id}`).catch((e) => toast({ kind: "error", title: "Suppression impossible", description: e.message }));
          qc.invalidateQueries({ queryKey: ["contacts"] });
          setDel(false);
          onClose();
        }}
      />
    </Sheet>
  );
}
