## Correções

### 1. Follow-up: parar de forçar HUMAN_AGENT
- Em `src/routes/api.webhooks.zernio.$token.ts`, remover `useHumanAgentTag: true` do `followupParams`. A janela de mensagens deve estar aberta pela private reply enviada segundos antes; sem o tag, a Meta trata como RESPONSE dentro da janela de 24h.
- Manter o suporte ao tag em `zernio.server.ts` (já está parametrizado), apenas não acionar por padrão. Se no futuro você obtiver aprovação da Meta, basta reativar.
- Atualizar o comentário do bloco explicando a decisão.

### 2. Post específico: garantir que o ID seja salvo
A causa é o `extractPostId()` em `src/routes/_dashboard.automations_.new.tsx` fazendo *fallback silencioso* — quando a URL/ID não casa com nenhum padrão (`*`, número, ou shortcode `/p|reel|tv/`), ele devolve a string crua e a automação é criada com lixo (ou, se o input estiver vazio quando o botão é clicado por outro caminho, com `*`). Mudanças:

- Em `extractPostId()`, retornar `null` quando não conseguir extrair um media ID válido (em vez de devolver `trimmed`).
- Em `handleConfirmPost()`, abortar com toast claro (`"Não consegui extrair o ID do post. Cole a URL completa, ex: instagram.com/p/Cxxxx ou o ID numérico."`) quando `extractPostId()` retornar `null`.
- Aceitar também URLs com query string e barra final (`/p/CODE/`, `?utm=...`) — ajustar o regex.
- Mostrar no card de confirmação (passo 2) o ID **decodificado** (numérico) ao lado do shortcode original, pra você ver na hora que ficou certo antes de salvar.
- Adicionar campo editável de "Post do Instagram" no `AutomationForm` (visível na edição também), com o mesmo `extractPostId`, pra você conseguir corrigir automações existentes sem recriar.

### Validação
- Criar uma automação nova colando uma URL real e confirmar que o `instagram_post_id` salvo no banco bate com o `platformPostId` que o webhook recebe.
- Disparar um comentário e conferir nos logs que (a) o match acontece e (b) o follow-up sai com `sent` em vez de 403.

### Detalhes técnicos
Arquivos tocados:
- `src/routes/api.webhooks.zernio.$token.ts` — remover `useHumanAgentTag: true` (linhas 520-524).
- `src/routes/_dashboard.automations_.new.tsx` — `extractPostId` retorna `null` em falha; `handleConfirmPost` valida; regex aceita trailing slash/query.
- `src/components/automation-form.tsx` — adicionar input editável de post ID + helper de decodificação compartilhado.
- `src/routes/_dashboard.automations_.$id.edit.tsx` — passar `instagram_post_id` editável (já vem do DB, só precisa do input no form).

Sem mudanças no banco. Sem migrations.