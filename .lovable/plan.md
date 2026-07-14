## Objetivo

No fluxo de DMs do webhook (`handleMessageEvent` em `src/routes/api.webhooks.zernio.$token.ts`), a checagem `isFollower === false` interrompe o processamento antes mesmo de buscar automações e envia uma mensagem fixa de "siga para ver o conteúdo". Isso causa dois problemas:

- DMs de não-seguidores geram log sem `automation_id` (não aparecem vinculadas a nenhuma automação da aba).
- A regra é global e não configurável — nenhuma automação atual tem toggle de "somente seguidores".

## Mudança

Arquivo único: `src/routes/api.webhooks.zernio.$token.ts`.

Remover o bloco `if (isFollower === false) { … follower_gate … }` (linhas ~308–333), incluindo o step `follower_gate`. O fluxo passa direto para:

1. `payloadFromClick` (quick reply) — inalterado.
2. Busca de automação `trigger_on_dm` por keyword — inalterada.
3. Envio (`dm_trigger_send`) ou skip (`no_dm_trigger_match`) — inalterados.

Consequências:

- Não-seguidores que mandam DM sem match de keyword: log `skipped` em `find_dm_trigger`, nenhuma mensagem enviada (comportamento correto, sem spam).
- Não-seguidores com keyword que casa: automação executa normalmente, log com `automation_id` correto.
- `isFollower` continua sendo lido do payload para uso futuro, mas não bloqueia mais nada.

## Fora do escopo

Não adicionar campo `followers_only` nas automações agora — nenhuma automação existente usa e o usuário pediu que seja opcional "se existir". Fica para pedido futuro específico, quando aí sim adicionaríamos coluna no schema + toggle no formulário + checagem por-automação após o match de keyword.

## Fluxo antes vs depois

```text
antes:  validar → settings → decrypt → [isFollower===false ⇒ follower_gate STOP]
        → quick_reply? → find_dm_trigger → send

depois: validar → settings → decrypt
        → quick_reply? → find_dm_trigger → send
```
