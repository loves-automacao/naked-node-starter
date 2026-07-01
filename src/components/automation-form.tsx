import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Plus, X, MessageCircle, Reply, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { AutomationInput } from "@/lib/automations.functions";
import { resolveInstagramMediaId } from "@/lib/instagram-post.functions";
import { withAuthFetch } from "@/lib/server-fetch";
import { parsePostInput } from "@/lib/instagram-post";


export interface AutomationFormValues {
  name: string;
  instagram_post_id: string;
  instagram_post_type: "post" | "story";
  custom_message: string;
  followup_message: string;
  quick_replies: { title: string; payload: string }[];
  buttons: { type: string; title: string; payload?: string; url?: string }[];
  is_active: boolean;
  keyword_filter_enabled: boolean;
  keywords: string;
  delay_min_seconds: number;
  delay_max_seconds: number;
  trigger_on_dm: boolean;
}

interface AutomationFormProps {
  initialValues: AutomationFormValues;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (data: AutomationInput) => void;
}

function slugify(text: string, fallback = "BTN"): string {
  const slug = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || `${fallback}_${Date.now().toString(36).toUpperCase()}`;
}

export function AutomationForm({ initialValues, submitLabel, submitting, onSubmit }: AutomationFormProps) {
  const navigate = useNavigate();
  const [form, setForm] = useState<AutomationFormValues>(initialValues);

  function update<K extends keyof AutomationFormValues>(key: K, value: AutomationFormValues[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function addQuickReply() {
    if (form.quick_replies.length >= 13) return;
    update("quick_replies", [...form.quick_replies, { title: "", payload: "" }]);
  }
  function updateQuickReplyTitle(i: number, title: string) {
    const u = [...form.quick_replies];
    u[i] = { title, payload: slugify(title, "QR") };
    update("quick_replies", u);
  }
  function removeQuickReply(i: number) {
    update("quick_replies", form.quick_replies.filter((_, idx) => idx !== i));
  }

  function addButton() {
    if (form.buttons.length >= 3) return;
    update("buttons", [...form.buttons, { type: "postback", title: "", payload: "" }]);
  }
  function updateButton(i: number, field: "title" | "payload" | "url" | "type", value: string) {
    const u = [...form.buttons];
    u[i] = { ...u[i], [field]: value };
    update("buttons", u);
  }
  function switchButtonType(i: number, type: "postback" | "web_url") {
    const u = [...form.buttons];
    if (type === "web_url") {
      u[i] = { type: "web_url", title: u[i].title, url: u[i].url ?? "", payload: undefined };
    } else {
      u[i] = { type: "postback", title: u[i].title, payload: slugify(u[i].title || "", "BTN"), url: undefined };
    }
    update("buttons", u);
  }
  function removeButton(i: number) {
    update("buttons", form.buttons.filter((_, idx) => idx !== i));
  }

  const resolveM = useMutation({
    mutationFn: (input: string) =>
      withAuthFetch(() => resolveInstagramMediaId({ data: { input } })),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parsePostInput(form.instagram_post_id);
    if (!parsed) {
      toast.error(
        "Post inválido. Use '*' para todos, ou cole URL/ID do post (ex: instagram.com/p/Cxxxx)."
      );
      return;
    }
    if (!form.custom_message.trim()) {
      toast.error("Mensagem da DM é obrigatória");
      return;
    }
    const urlButtonInvalid = form.buttons.find(
      (b) => b.title.trim() && b.type === "web_url" && !/^https?:\/\/.+/.test(b.url ?? "")
    );
    if (urlButtonInvalid) {
      toast.error(`Botão "${urlButtonInvalid.title}": URL inválida (deve começar com http:// ou https://)`);
      return;
    }

    // Se for shortcode/URL, resolve pelo media_id via Zernio antes de salvar.
    let normalizedPostId: string;
    if (parsed.kind === "shortcode") {
      try {
        const { mediaId } = await resolveM.mutateAsync(form.instagram_post_id);
        normalizedPostId = mediaId;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao resolver post na Zernio");
        return;
      }
    } else {
      normalizedPostId = parsed.kind === "wildcard" ? "*" : parsed.value;
    }

    onSubmit({
      name: form.name,
      instagram_post_id: normalizedPostId,
      instagram_post_type: form.instagram_post_type,
      custom_message: form.custom_message,
      followup_message: form.followup_message,
      quick_replies: form.quick_replies.filter((q) => q.title.trim()),
      buttons: form.buttons
        .filter((b) => b.title.trim())
        .map((b) =>
          b.type === "web_url"
            ? { type: "web_url", title: b.title, url: b.url?.trim() ?? "" }
            : { type: "postback", title: b.title, payload: b.payload ?? slugify(b.title, "BTN") }
        ),
      is_active: form.is_active,
      keyword_filter_enabled: form.keyword_filter_enabled,
      keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
      delay_min_seconds: form.delay_min_seconds,
      delay_max_seconds: form.delay_max_seconds,
      trigger_on_dm: form.trigger_on_dm,
    });
  }


  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {form.instagram_post_id === "*" ? "Todos os posts" : form.instagram_post_type}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Cole a URL do post, o shortcode, o ID numérico, ou <code className="rounded bg-muted px-1">*</code> para todos.
            </span>
          </div>
          <Input
            value={form.instagram_post_id}
            onChange={(e) => update("instagram_post_id", e.target.value)}
            placeholder="https://www.instagram.com/p/Cxxxx ou 17931201761893324"
          />
          {(() => {
            const parsed = parsePostInput(form.instagram_post_id);
            if (!form.instagram_post_id.trim()) return null;
            if (!parsed) {
              return (
                <p className="text-xs text-destructive">Formato inválido — cole URL, shortcode, ID numérico ou *.</p>
              );
            }
            if (parsed.kind === "shortcode") {
              return (
                <p className="text-xs text-muted-foreground">
                  Shortcode <code className="rounded bg-muted px-1">{parsed.value}</code> — será resolvido pelo media_id ao salvar (via Zernio).
                </p>
              );
            }
            return null;
          })()}

        </CardContent>
      </Card>


      <div className="flex flex-col gap-1.5">
        <Label htmlFor="auto-name">Nome da automação</Label>
        <Input
          id="auto-name"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="Ex: Ebook gratuito"
          required
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="is-active">Automação ativa</Label>
          <p className="text-xs text-muted-foreground">Quando ativa, responde automaticamente aos comentários.</p>
        </div>
        <Switch id="is-active" checked={form.is_active} onCheckedChange={(v) => update("is_active", v)} />
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-primary" />
          <Label className="text-base font-medium">DM Privada (1ª mensagem)</Label>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Enviada como resposta privada ao comentário. Somente texto.
        </p>
        <textarea
          placeholder="Oi! Obrigado por comentar no nosso post..."
          value={form.custom_message}
          onChange={(e) => update("custom_message", e.target.value)}
          rows={3}
          className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
        />
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <Reply className="size-4 text-primary" />
          <Label className="text-base font-medium">Follow-up com botões (2ª mensagem)</Label>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Enviada logo após a DM privada. Suporta quick replies e botões nativos. Opcional.
        </p>

        <textarea
          placeholder="Clica no botão abaixo pra receber 👇"
          value={form.followup_message}
          onChange={(e) => update("followup_message", e.target.value)}
          rows={2}
          className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
        />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>Botões de resposta rápida</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Botões temporários que somem após o clique.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">{form.quick_replies.length}/13</span>
          </div>
          {form.quick_replies.map((qr, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder="Texto do botão (ex: Quero o link!)"
                value={qr.title}
                onChange={(e) => {
                  const title = e.target.value.slice(0, 20);
                  updateQuickReplyTitle(i, title);
                }}
                maxLength={20}
                className="flex-1"
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => removeQuickReply(i)}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
          {form.quick_replies.length < 13 && (
            <Button type="button" variant="outline" size="sm" onClick={addQuickReply} className="w-fit">
              <Plus className="size-4 mr-1" /> Adicionar quick reply
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Botões nativos (fixos)</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Botões fixos na mensagem que não desaparecem. Podem responder no DM ou abrir um link. Máx 3.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">{form.buttons.length}/3</span>
          </div>
          {form.buttons.map((btn, i) => {
            const isUrl = btn.type === "web_url";
            return (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <select
                    value={btn.type}
                    onChange={(e) => switchButtonType(i, e.target.value as "postback" | "web_url")}
                    className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
                  >
                    <option value="postback">Responde no DM</option>
                    <option value="web_url">Abrir link</option>
                  </select>
                  <Input
                    placeholder="Texto do botão (ex: Ver produtos)"
                    value={btn.title}
                    onChange={(e) => {
                      const title = e.target.value.slice(0, 20);
                      const u = [...form.buttons];
                      if (isUrl) {
                        u[i] = { ...u[i], title };
                      } else {
                        u[i] = { ...u[i], title, payload: slugify(title, "BTN") };
                      }
                      update("buttons", u);
                    }}
                    maxLength={20}
                    className="flex-1"
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeButton(i)}>
                    <X className="size-4" />
                  </Button>
                </div>
                {isUrl && (
                  <Input
                    placeholder="https://exemplo.com/pagina"
                    type="url"
                    value={btn.url ?? ""}
                    onChange={(e) => updateButton(i, "url", e.target.value)}
                  />
                )}
              </div>
            );
          })}
          {form.buttons.length < 3 && (
            <Button type="button" variant="outline" size="sm" onClick={addButton} className="w-fit">
              <Plus className="size-4 mr-1" /> Adicionar botão nativo
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <Label>Filtro por palavras-chave</Label>
          <Switch checked={form.keyword_filter_enabled}
            onCheckedChange={(v) => update("keyword_filter_enabled", v)} />
        </div>
        {form.keyword_filter_enabled && (
          <Input placeholder="quero, ebook, link (separadas por vírgula)"
            value={form.keywords} onChange={(e) => update("keywords", e.target.value)} />
        )}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-4">
        <div className="flex flex-col gap-0.5">
          <Label>Disparar também em mensagens de story/DM</Label>
          <p className="text-xs text-muted-foreground">
            Quando alguém responder um story ou mandar DM direto, essa automação também dispara
            (respeitando o filtro de palavras-chave, se configurado).
          </p>
        </div>
        <Switch
          checked={form.trigger_on_dm}
          onCheckedChange={(v) => update("trigger_on_dm", v)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Delay de resposta (segundos)</Label>
        <p className="text-xs text-muted-foreground">Entre 30 e 120 segundos.</p>
        <div className="flex items-center gap-3">
          <Input type="number" min={30} max={120} value={form.delay_min_seconds}
            onChange={(e) => update("delay_min_seconds", parseInt(e.target.value) || 30)} className="w-24" />
          <span className="text-sm text-muted-foreground">a</span>
          <Input type="number" min={30} max={120} value={form.delay_max_seconds}
            onChange={(e) => update("delay_max_seconds", parseInt(e.target.value) || 60)} className="w-24" />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => navigate({ to: "/automations" })} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={submitting || resolveM.isPending}>
          {submitting || resolveM.isPending ? <Loader2 className="size-4 animate-spin" /> : submitLabel}

        </Button>
      </div>
    </form>
  );
}
