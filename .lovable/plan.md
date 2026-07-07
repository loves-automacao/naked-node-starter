## Objetivo

Rastrear cada etapa da execução de uma automação com timestamps, status, duração e erros detalhados — e exibir uma timeline por execução na tela de Logs.

## Modelo de dados

Nova tabela `automation_log_steps` (etapas), mantendo `automation_logs` como o "cabeçalho" da execução:

- `automation_log_steps`: `id`, `log_id` (FK → automation_logs), `user_id`, `step` (text: `webhook_received`, `keyword_matched`, `private_reply`, `find_conversation`, `followup`, `outgoing_webhook`, `follower_gate`, `dm_trigger`, `content_delivery`, `automation_finished`, etc.), `label` (texto legível pt-BR), `status` (`started` | `success` | `failed` | `skipped`), `duration_ms` (int), `error_message` (text), `api_status_code` (int), `api_response` (jsonb — corpo curto/resumo da resposta Instagram/Zernio), `context` (jsonb — parâmetros da operação: conversationId, postId, quickReplies count, etc.), `created_at`.

Colunas adicionadas em `automation_logs`:
- `event_type` (text — `comment.received`, `message.received`, ...)
- `trigger_keyword` (text — palavra que casou, quando houver)
- `stopped_at_step` (text — nome da última etapa em falha)
- `total_duration_ms` (int)
- `finished_at` (timestamp)

RLS: SELECT scoped ao `user_id` para authenticated; INSERT/UPDATE só via service_role (webhook usa `supabaseAdmin`). Índice em `(log_id, created_at)` para ordenar a timeline.

## Instrumentação do webhook

`src/routes/api.webhooks.zernio.$token.ts`:

- Criar helper `createStepLogger(logId, userId)` que expõe:
  - `step(name, label, context?)` → retorna `{ success(apiRes?), fail(err, apiRes?), skip(reason) }`, cada um insere/atualiza a linha `automation_log_steps` com `duration_ms` calculado desde o início do step.
  - Todas as inserções via `supabaseAdmin`, non-blocking (Promise coletada em array e `await Promise.allSettled` no fim).
- Instrumentar todos os caminhos:
  1. `webhook_received` (payload parse, event_type).
  2. `keyword_matched` / `no_match` (registra qual palavra casou → salva em `automation_logs.trigger_keyword`).
  3. `private_reply` (1ª DM) — captura status/msg de erro da Zernio (parsear `Zernio API 4xx: {...}` em `zernio.server.ts`).
  4. `find_conversation` (com retry como etapa própria).
  5. `followup` (2ª mensagem com botões/quickReplies — grava counts no `context`).
  6. `outgoing_webhook`.
  7. `automation_finished` — grava `stopped_at_step`, `total_duration_ms`, `finished_at` no header.
- Substituir mensagens genéricas (`deliver:`, `dm_trigger:`, `follower_gate:`) por labels em pt-BR e erros contendo a resposta bruta da API.
- `zernio.server.ts`: mudar `zernioFetch` para lançar um erro tipado com `{ status, body }` para o step logger capturar `api_status_code` e `api_response` sem regex.

## Server functions

`src/lib/logs.functions.ts`:
- Manter `listLogs` (cabeçalhos).
- Adicionar `getLogSteps({ logId })` com `requireSupabaseAuth` → retorna steps ordenados.

## UI — Tela de Logs

`src/routes/_dashboard.logs.tsx` reescrito como lista de execuções com detalhe expansível:

- Lista à esquerda (ou linhas colapsáveis): @usuário, evento, status geral, hora, duração total, badge da etapa onde parou (quando `failed`).
- Ao clicar/expandir: timeline vertical estilo:
  ```
  ● 10:15:01  Automação iniciada                        (event: comment.received)
  ● 10:15:02  Palavra-chave "ebook" encontrada
  ● 10:15:02  Enviando primeira DM…                    started
  ✓ 10:15:03  Primeira DM enviada com sucesso          892ms
  ● 10:15:03  Buscando conversa…
  ✓ 10:15:03  Conversa encontrada                      210ms
  ● 10:15:03  Enviando follow-up…
  ✗ 10:15:04  Instagram: "Conversation not found"      HTTP 400 · 640ms
  ⨯ 10:15:04  Automação encerrada em: followup
  ```
- Cada linha do erro mostra `api_status_code`, trecho do `api_response` e o `context` (botões=2, quickReplies=3, conversationId=…) num `<details>`.
- Ícones/coloração por status: cinza (started), verde (success), vermelho (failed), amarelo (skipped).
- Realtime: subscribe em `automation_log_steps` filtrado por `user_id` para atualizar a timeline aberta ao vivo.
- Botão "Copiar diagnóstico" que serializa toda a timeline pra colar no suporte.

## Arquivos

- **Migration**: nova tabela + colunas + RLS + índice.
- **Editados**: `src/routes/api.webhooks.zernio.$token.ts`, `src/server/zernio.server.ts` (erro tipado), `src/lib/logs.functions.ts`, `src/routes/_dashboard.logs.tsx`.
- **Novos**: `src/lib/step-logger.server.ts` (helper), `src/components/log-timeline.tsx` (UI da timeline).

## Validação

1. Disparar automação com comentário → conferir sequência completa `webhook_received → keyword_matched → private_reply(success) → find_conversation(success) → followup(success) → automation_finished`.
2. Forçar erro de follow-up (post sem janela 24h) → timeline mostra `followup` failed com HTTP status + mensagem Meta e header com `stopped_at_step="followup"`.
3. Comentário que não casa keyword → único step `keyword_matched` com status `skipped` e razão.
4. Realtime: com a página aberta, um novo webhook aparece sem refresh.
