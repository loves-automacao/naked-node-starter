# Mensagem automática algum tempo depois do gatilho

Confirmei na documentação da Zernio: existe mesmo o recurso de **Sequências** (`/v1/sequences`), com passos que têm atraso em minutos, além de `exitOnReply` e `exitOnUnsubscribe`. Ou seja, o próprio Zernio guarda a fila e dispara na hora certa — não precisamos criar fila nem rotina de verificação no nosso banco. É o caminho mais simples e confiável.

## Como vai funcionar

Na tela de criar/editar automação entra um bloco novo, opcional:

- Liga/desliga "Mensagem depois de um tempo".
- Texto da mensagem.
- Quando enviar: número + unidade (minutos / horas / dias). Padrão sugerido: 1 dia.
- Opção "não enviar se a pessoa já tiver respondido" (ligada por padrão).

Ao salvar a automação com esse bloco ligado, o app cria (ou atualiza) uma sequência correspondente na Zernio com um passo, guardando o identificador dela junto da automação. Se o bloco for desligado, a sequência é pausada.

Quando alguém comenta e a automação roda normalmente, logo depois do envio das mensagens imediatas a pessoa é inscrita nessa sequência. A Zernio faz o disparo no prazo configurado.

## O que aparece nos logs

Duas etapas novas na linha do tempo do log: "Inscrevendo na sequência" (com sucesso/erro) e o resultado retornado pela Zernio. O envio em si acontece do lado deles, então o log mostra a inscrição, não a entrega final — para conferir entregas, a aba de sequências do painel Zernio é a fonte.

## Limite do Instagram

A Meta só permite DM dentro de 24h após a última interação da pessoa. Um atraso de 1 dia fica no limite: se a pessoa não interagiu mais, a Meta pode recusar a entrega. O campo vai mostrar esse aviso quando o atraso passar de 23 horas, e sugerir 23h como valor seguro.

## Detalhes técnicos

- Migration em `automations`: `delayed_enabled boolean default false`, `delayed_message text default ''`, `delayed_delay_minutes integer default 1440`, `delayed_exit_on_reply boolean default true`, `zernio_sequence_id text`.
- `src/server/zernio.server.ts`: novas funções `zernioCreateSequence` (POST `/sequences` com `profileId`, `accountId`, `platform: "instagram"`, `name`, `steps: [{ order: 1, delayMinutes, message: { text } }]`, `exitOnReply`, `exitOnUnsubscribe: true`), `zernioUpdateSequence` (PATCH), `zernioActivateSequence` / `zernioPauseSequence`, `zernioEnrollContact` (POST `/sequences/{id}/enroll` com `contactIds`), e `zernioGetProfileId` (GET `/profiles`, primeiro perfil do dono da conta) — o `profileId` é obrigatório na criação.
- `src/lib/automations.functions.ts`: em create/update, quando `delayed_enabled`, sincroniza a sequência na Zernio (criar → ativar, ou atualizar) e persiste `zernio_sequence_id`; quando desligado, pausa. Falha de API não bloqueia o salvamento — retorna aviso para a UI mostrar um toast.
- `src/routes/api.webhooks.zernio.$token.ts`: após o bloco de follow-up (e no fluxo de DM), se a automação tem `zernio_sequence_id` ativo, resolve o contato e chama enroll, dentro de um step `sequence_enroll` do `step-logger.server.ts`. O contato vem de `sender.contactId` / `conversation.contactId` do payload (a doc confirma esses campos); ausente, cai para `POST /v1/contacts` criando um canal Instagram com o `participantId` (IGSID) e usa o id retornado.
- `src/lib/automation-rules.ts`: valida `delayed_message` não vazio quando ligado (máx. 1000 caracteres) e `delayed_delay_minutes` entre 1 e 10080 (7 dias).
- `src/components/automation-form.tsx`: bloco de UI com switch, textarea + contador, número + select de unidade convertendo para minutos, switch de "sair se responder" e aviso acima de 1380 minutos.
