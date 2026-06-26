
# InstaReply — guia completo pra clonar

Tudo que outra IA precisa pra reconstruir esse SaaS do zero.

---

## 1. O que é

SaaS multi-tenant que automatiza respostas no Instagram via comentários e DMs. O usuário cria "automações" tipo: *"quando alguém comentar 'quero' no post X, mande uma DM com o link Y e botão Z"*. O fluxo passa pela **Zernio** (gateway oficial que fala com a Meta API por baixo) — o app não fala direto com o Instagram.

**Modelo de negócio:** cada usuário liga sua API Key da Zernio, conecta o IG, cria automações. Cada usuário tem uma **URL de webhook única** (token de 32 chars) que ele cola no painel da Zernio. Quando rola um comentário, a Zernio dispara POST nessa URL.

---

## 2. Stack

| Camada | Tech |
|---|---|
| Framework | TanStack Start v1 (React 19, SSR em Cloudflare Workers) |
| Build | Vite 7, Tailwind v4 |
| UI | shadcn/ui + next-themes (dark default) |
| Reads | TanStack Query |
| Writes | `createServerFn` (TanStack RPC) |
| Webhooks | TanStack server routes (`src/routes/api.*.ts`) |
| DB + Auth | Supabase (Postgres + Auth) |
| External | Zernio API (`https://zernio.com/api/v1`) |

**Regra crítica:** lógica interna usa `createServerFn`; **nunca** Edge Functions Supabase. Webhook externo da Zernio é a única coisa que vira server route HTTP.

---

## 3. Fluxo principal

```text
Comentário no IG
   ↓
Meta → Zernio (gateway)
   ↓
POST /api/webhooks/zernio/{token}   ← URL única por usuário
   ↓
1. resolve user pelo token         (tabela profiles.webhook_token)
2. insere log inicial              (automation_logs, status=received)
3. busca automações ativas         (filtra por post_id + keywords)
4. descriptografa zernio_api_key   (AES-GCM, secret APP_ENCRYPTION_KEY)
5. POST /inbox/comments/:postId/:commentId/private-reply  (1ª msg pública)
6. GET  /inbox/conversations?accountId=...                (acha conv_id)
7. POST /inbox/conversations/:id/messages                 (DM com quick replies + buttons)
8. atualiza log (status=sent) + incrementa automations.total_sent
   ↓
Responde 200 pra Zernio (sempre 2xx pra não reenviar)
```

Variações de evento:
- **`comment.received`** → fluxo acima.
- **`message.received` com `quickReply.payload`** → usuário clicou no botão; entrega o `followup_message` da automação mais recente.
- **`message.received` sem payload** → DM direta, casa com automações `trigger_on_dm = true`.
- **Sender com `isFollower === false`** → follower-gate: manda "Me segue e clica em 'Pronto' de novo" + quick reply pra retomar fluxo.

---

## 4. Schema SQL (DDL completo)

```sql
-- ============ profiles (1:1 com auth.users) ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  webhook_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own profile"   ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- ============ user_settings ============
CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  zernio_api_key_encrypted text,            -- AES-GCM base64
  zernio_account_id text,                   -- _id da conta IG na Zernio
  instagram_connected boolean NOT NULL DEFAULT false,
  instagram_username text,
  outgoing_webhook_url text,                -- opcional: reenvia eventos pro user
  outgoing_webhook_enabled boolean NOT NULL DEFAULT false,
  published_origin text,                    -- auto-detectado pra mostrar URL pública
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own settings"   ON public.user_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert own settings" ON public.user_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update own settings" ON public.user_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- ============ automations ============
CREATE TABLE public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  instagram_post_id text NOT NULL,                       -- "*" = qualquer post
  instagram_post_type text NOT NULL DEFAULT 'post',
  custom_message text NOT NULL DEFAULT '',               -- 1ª msg (private reply)
  followup_message text NOT NULL DEFAULT '',             -- 2ª msg (DM)
  quick_replies jsonb NOT NULL DEFAULT '[]',             -- [{title,payload}], max 13
  buttons jsonb NOT NULL DEFAULT '[]',                   -- [{type,title,url?,payload?}], max 3
  keywords text[] NOT NULL DEFAULT '{}',
  keyword_filter_enabled boolean NOT NULL DEFAULT false,
  trigger_on_dm boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  delay_min_seconds int NOT NULL DEFAULT 30,             -- 30-120
  delay_max_seconds int NOT NULL DEFAULT 60,
  total_sent int NOT NULL DEFAULT 0,
  total_failed int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automations TO authenticated;
GRANT ALL ON public.automations TO service_role;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own automations all" ON public.automations FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ automation_logs ============
CREATE TABLE public.automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  automation_id uuid REFERENCES public.automations(id) ON DELETE SET NULL,
  instagram_user text,
  instagram_post_id text,
  comment_text text,
  message_sent text,
  status text NOT NULL DEFAULT 'pending',  -- received | sent | failed | skipped
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.automation_logs TO authenticated;
GRANT ALL ON public.automation_logs TO service_role;  -- webhook insere via service_role
ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own logs" ON public.automation_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============ trigger de signup ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)));
  INSERT INTO public.user_settings (user_id) VALUES (NEW.id);
  RETURN NEW;
END $$;
-- aplicar: CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
--         FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

---

## 5. Contrato Zernio (4 endpoints usados)

Base: `https://zernio.com/api/v1`. Auth: `Authorization: Bearer <apiKey>`.

### a) `GET /accounts` — descobrir conta IG
```json
// resp
{ "accounts": [{ "_id": "abc", "platform": "instagram", "username": "lojinha", "isActive": true }] }
```
Filtrar `platform === "instagram"`. Salvar `_id` em `user_settings.zernio_account_id`.

### b) `POST /inbox/comments/:postId/:commentId/private-reply` — 1ª resposta
```json
// req
{ "accountId": "...", "message": "Te mandei no privado! 💌" }
```
Text only. **Não exige** janela de 24h. Timeout 7s.

### c) `GET /inbox/conversations?accountId=...` — achar conversa
```json
// resp
{ "data": [{ "id": "conv_1", "participantId": "ig_user_id", "participants": [...] }] }
```
Match: `c.participantId === comment.author.id`. Pode levar 1-2s pra Zernio criar a conversa após o private-reply → fazer **retry** se vazio.

### d) `POST /inbox/conversations/:id/messages` — DM com mídia
```json
// req
{
  "accountId": "...",
  "message": "Aqui está o link 👇",
  "quickReplies": [{ "title": "Pronto! ✅", "payload": "SEND_CONTENT" }],
  "template": {
    "type": "generic",
    "elements": [{
      "title": "Aqui está o link 👇",
      "buttons": [
        { "type": "url", "title": "Abrir", "url": "https://..." },
        { "type": "postback", "title": "Quero outro", "payload": "MORE" }
      ]
    }]
  }
}
```

**Regras descobertas na marra (validadas com suporte Zernio 2026-04-22):**
- `message` sempre string no root, nunca vazia (fallback `"👇"`).
- `quickReplies`: max **13**.
- `buttons` no `template.elements[0].buttons`: max **3**.
- `type: "url"` (NÃO `"web_url"` — Zernio traduz internamente; usar `web_url` direto dá 400).
- Dentro de 24h Meta trata como RESPONSE por default — não precisa `messagingType`.
- Pra fora de 24h: `messagingType: "MESSAGE_TAG"` + `messageTag: "HUMAN_AGENT"`.

---

## 6. Payloads que a Zernio envia pro webhook

### `comment.received`
```json
{
  "event": "comment.received",
  "comment": {
    "id": "cmt_123",
    "platformPostId": "17890123",
    "text": "quero!",
    "author": { "id": "ig_user_456", "username": "fulano" }
  },
  "post": { "platformPostId": "17890123" },
  "account": { "id": "...", "platform": "instagram", "username": "lojinha" },
  "timestamp": "2026-..."
}
```

### `message.received`
```json
{
  "event": "message.received",
  "message": {
    "id": "msg_789",
    "conversationId": "conv_1",
    "text": "oi",
    "quickReply": { "payload": "SEND_CONTENT" },   // só se clicou em botão
    "sender": {
      "id": "ig_user_456",
      "username": "fulano",
      "instagramProfile": { "isFollower": true }
    }
  },
  "account": { "id": "...", "username": "lojinha" }
}
```

---

## 7. Regras de matching (no webhook)

```ts
const matching = automations.find(a => {
  if (!a.is_active) return false;
  if (a.instagram_post_id !== "*" && a.instagram_post_id !== comment.postId) return false;
  if (a.keyword_filter_enabled) {
    const hit = a.keywords.some(k => comment.text.toLowerCase().includes(k.toLowerCase()));
    if (!hit) return false;
  }
  return true;
});
```

Para DM direta (`message.received` sem `quickReply`): mesma lógica mas exigindo `trigger_on_dm = true`. Skip se `sender.username === account.username` (auto-mensagem).

---

## 8. Estrutura de pastas

```text
src/
  routes/
    __root.tsx                          # ThemeProvider + auth listener + <Outlet/>
    index.tsx                           # landing → redirect /login ou /dashboard
    login.tsx                           # email/password
    _dashboard.tsx                      # layout autenticado (sidebar shadcn)
    _dashboard.dashboard.tsx            # KPIs últimos 7d
    _dashboard.automations.tsx          # lista + toggle on/off
    _dashboard.automations_.new.tsx     # form de criação
    _dashboard.automations_.$id.edit.tsx
    _dashboard.logs.tsx                 # paginado
    _dashboard.templates.tsx            # presets prontos pra clonar
    _dashboard.settings.tsx             # API key, conectar IG, URL do webhook
    _dashboard.help.tsx
    api.webhooks.zernio.$token.ts       # ⚠️ ENDPOINT PÚBLICO, sem auth
    api.debug.zernio.ts                 # endpoint de teste manual
  server/
    automations.functions.ts            # CRUD com createServerFn + requireSupabaseAuth
    settings.functions.ts               # saveZernioApiKey, connectInstagram, etc
    dashboard.functions.ts              # agregações
    logs.functions.ts                   # listagem
    zernio.server.ts                    # client HTTP da Zernio (4 funções)
    crypto.server.ts                    # encrypt/decrypt AES-GCM
    detect-origin.server.ts             # auto-grava published_origin
    wait-until.server.ts                # helper waitUntil (não usado no fluxo final)
  integrations/supabase/
    client.ts                           # browser
    client.server.ts                    # service-role (só no webhook)
    auth-middleware.ts                  # requireSupabaseAuth
    types.ts                            # gerado
  components/
    automation-form.tsx                 # form compartilhado new/edit
    theme-provider.tsx
    ui/*                                # shadcn
  styles.css                            # Tailwind v4
```

---

## 9. Decisões arquiteturais (e o porquê)

| Decisão | Motivo |
|---|---|
| **API key cifrada na coluna** (AES-256-GCM, key em `APP_ENCRYPTION_KEY`) | Service role pode ler a tabela; precisa de outra camada antes de chegar texto plano. |
| **Webhook nunca retorna 5xx** — wrapper try/catch sempre devolve 200 | Zernio reenviaria o evento; loop infinito de erros. Falhas viram linha em `automation_logs` com `status=failed`. |
| **Processamento síncrono** (3-6s, cabe no timeout 10s da Zernio) | Tentamos `ctx.waitUntil` antes, mas o runtime do Worker mata a promise. Como Zernio responde rápido (<2s por chamada), aguardar tudo é seguro. |
| **Webhook token por usuário** (32 chars hex) em vez de HMAC | Zernio não oferece assinatura. Token é o segredo — URL única e impossível de adivinhar. |
| **Auto-detect do origin publicado** (`detectAndPersistPublicOrigin`) | Preview do Lovable não é acessível externamente. Quando o user abre o dashboard pela URL pública, server fn salva o origin em `user_settings.published_origin` pra mostrar a URL do webhook montada certa na tela de Settings. |
| **Follower-gate** | Política Meta: muitas DMs pra não-seguidor pode bloquear conta. Antes de entregar conteúdo gated, exige follow. |
| **`createServerFn` pra tudo interno, server route só pro webhook** | TanStack Start nativo; Edge Functions Supabase seriam um sistema paralelo. |
| **`requireSupabaseAuth` middleware em todos os server fns** | Anexa user autenticado ao contexto; RLS escopa queries; impossível ler dados de outro user. |
| **Service-role só no webhook** | Webhook não tem JWT do user (vem da Zernio); usa `supabaseAdmin` (bypassa RLS) e resolve user manualmente pelo `webhook_token`. |
| **Defensivo no jsonb** (`parseJsonbArray`) | Supabase pode devolver jsonb como string, array ou null dependendo do client. |

---

## 10. Variáveis de ambiente

**Server-only (process.env, dentro de handler):**
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `APP_ENCRYPTION_KEY` — 32 bytes base64, AES-GCM
- `ZERNIO_API_BASE` — opcional, default `https://zernio.com/api/v1`

**Client (import.meta.env):**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`

---

## 11. Telas (UX)

| Rota | Propósito |
|---|---|
| `/login` | Email/senha, Supabase Auth. |
| `/dashboard` | KPIs: total disparos 7d, taxa sucesso, automações ativas, últimos logs. |
| `/automations` | Lista com switch ativo/inativo + contador de envios. |
| `/automations/new` & `/automations/:id/edit` | Form: nome, post_id (ou `*`), 1ª msg, follow-up, quick replies (drag pra reordenar), buttons (url ou postback), keywords, delay min/max, trigger_on_dm. |
| `/logs` | Tabela paginada com status colorido (verde sent, vermelho failed, cinza skipped), filtro por status. |
| `/templates` | Cards com presets ("Lead magnet ebook", "Cupom desconto", etc) → clica e abre `/automations/new` preenchido. |
| `/settings` | API Key da Zernio (write-only, mostra `••••`), botão "Conectar Instagram" (chama `/accounts`), URL do webhook pra colar na Zernio (montada com `published_origin + /api/webhooks/zernio/ + webhook_token`), webhook outgoing opcional. |
| `/help` | FAQ. |

---

## 12. Prompt pra colar em outra IA

> Construa um SaaS chamado **InstaReply** usando **TanStack Start v1** (React 19, Vite 7, SSR em Cloudflare Workers), **Tailwind v4 + shadcn/ui**, **TanStack Query** pra reads e **createServerFn** pra writes, com **Supabase** (Postgres + Auth) como backend.
>
> O app conecta com a **Zernio API** (`https://zernio.com/api/v1`, auth `Bearer <apiKey>`) que é um gateway pro Instagram. Cada usuário cadastra a API key dele (cifrada com AES-GCM antes de salvar) e tem uma **URL de webhook única** (`/api/webhooks/zernio/{token}` onde token é um hex de 32 chars guardado em `profiles.webhook_token`). Essa URL é pública, sem auth, e a Zernio dispara POSTs nela com eventos `comment.received` e `message.received`.
>
> **Quando chega um comentário:** o webhook resolve o usuário pelo token, busca automações ativas (filtrando por `instagram_post_id` que pode ser `"*"` e por `keywords`), descriptografa a API key, e:
> 1. POST `/inbox/comments/{postId}/{commentId}/private-reply` com body `{accountId, message}` (1ª resposta pública).
> 2. GET `/inbox/conversations?accountId=...` pra achar a conversa (match por `participantId`); fazer retry se vazio.
> 3. POST `/inbox/conversations/{id}/messages` com body `{accountId, message, quickReplies?, template?}` onde `quickReplies` é `[{title,payload}]` (max 13) e `template = {type:"generic", elements:[{title, buttons:[{type:"url"|"postback", title, url?, payload?}]}]}` (max 3 botões; use `type:"url"`, NÃO `"web_url"`).
>
> **Webhook NUNCA retorna 5xx** (Zernio reenviaria); tudo dentro de try/catch retornando 200 com `{ok:true,error}`. Log de cada evento vai pra tabela `automation_logs` com status `received|sent|failed|skipped`.
>
> Tabelas: `profiles` (id=auth.users.id, email, name, webhook_token default `replace(gen_random_uuid()::text,'-','')`), `user_settings` (user_id PK, zernio_api_key_encrypted, zernio_account_id, instagram_connected, instagram_username, published_origin), `automations` (id, user_id, name, instagram_post_id, custom_message, followup_message, quick_replies jsonb, buttons jsonb, keywords text[], keyword_filter_enabled bool, trigger_on_dm bool, is_active bool, delay_min/max_seconds, total_sent, total_failed), `automation_logs` (id, user_id, automation_id, instagram_user, instagram_post_id, comment_text, message_sent, status, error). RLS habilitado escopado a `auth.uid()` em todas. Trigger `handle_new_user` cria profile+settings no signup.
>
> Telas autenticadas sob layout `_dashboard`: dashboard (KPIs 7d), automations (lista+toggle), automations/new e /:id/edit (form completo), logs (paginado), templates (presets), settings (API key write-only, conectar IG, URL do webhook pra copiar), help.
>
> Variantes: se `message.received` tem `quickReply.payload` → entrega `followup_message`; se DM direta → casa com automações `trigger_on_dm=true`; se `sender.instagramProfile.isFollower===false` → manda follower-gate ("Me segue e clica em Pronto de novo").
>
> Use `createServerFn` + middleware `requireSupabaseAuth` pra tudo interno. Use `supabaseAdmin` (service role) **só** no webhook, importado **dentro** do handler (`await import(...)`) pra não vazar no bundle do client. Secrets em env vars: `APP_ENCRYPTION_KEY` (32B base64), `SUPABASE_SERVICE_ROLE_KEY`, etc — lidos dentro do `.handler()`, nunca no escopo do módulo.

---

Quer que eu salve isso como `CLONE.md` na raiz do projeto também?
