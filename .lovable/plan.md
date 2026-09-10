# Mensagem atrasada (ex.: 1 dia depois do trigger)

Hoje a automação envia duas mensagens na hora (primeira DM + follow-up). A ideia é ter uma **terceira mensagem opcional**, enviada automaticamente depois de um tempo configurável.

## Aviso importante sobre o Instagram

O Instagram só permite mandar DM para alguém dentro de **24 horas** após a última interação da pessoa. Passou disso, a Meta bloqueia o envio (é o mesmo erro 403 que já apareceu antes com a tag de "atendimento humano", que exige aprovação da Meta).

Consequência prática:

- Atraso de até 24h: funciona normalmente.
- Atraso de 1 dia ou mais: só chega se a pessoa tiver respondido nesse meio tempo (o relógio reinicia a cada resposta dela). Senão, a tentativa é registrada nos logs como falha explicando o motivo.

Por isso o campo vai sugerir **23 horas** como padrão seguro, permitindo valores maiores com um aviso visível na tela.

## O que muda

**1. Configuração na automação**

Novos campos no formulário de automação (Nova / Editar):

- Liga/desliga "Mensagem atrasada".
- Texto da mensagem (com contador de caracteres, como os outros campos).
- Atraso: número + unidade (minutos / horas / dias), com aviso quando passar de 24h.

**2. Fila de envios**

Quando o trigger roda e a primeira DM é enviada com sucesso, a automação agenda a mensagem atrasada numa fila no banco, com a hora prevista de envio, o destinatário e o texto.

**3. Processador automático**

Uma rotina roda a cada 15 minutos, pega os envios vencidos, manda pela Zernio e marca como enviado ou falho. Cada tentativa aparece na linha do tempo do log original, junto com as outras etapas — então o histórico continua num lugar só.

Cadência: 15 em 15 minutos significa 96 verificações por dia e um atraso máximo de 15 minutos em relação ao horário exato. Verificações mais frequentes mantêm o banco acordado mesmo sem trabalho e aumentam o custo; 15 minutos é o equilíbrio para uma mensagem que já é de horas/dias.

## Detalhes técnicos

- Migration: colunas `delayed_message_enabled`, `delayed_message`, `delayed_delay_seconds` em `automations`; nova tabela `scheduled_messages` (`user_id`, `automation_id`, `log_id`, `recipient_id`, `message`, `send_after`, `status`, `attempts`, `error`, `sent_at`) com GRANTs, RLS por `auth.uid()` e índice em `(status, send_after)`.
- Enfileiramento em `src/routes/api.webhooks.zernio.$token.ts`, após o bloco de follow-up, usando o client admin (o webhook já roda sem sessão).
- Novo endpoint `src/routes/api/public/hooks/process-scheduled.ts`: valida o header `apikey`, busca `status='pending' AND send_after <= now()` (limite 50), descriptografa a chave Zernio do dono, localiza a conversa via `zernioFindConversationId` e envia com `zernioSendConversationMessage`. Falha por janela de 24h fechada é marcada como `failed` com mensagem amigável (sem retry infinito: máximo 3 tentativas).
- `pg_cron` + `pg_net` chamando esse endpoint a cada 15 min (`*/15 * * * *`), configurado via SQL direto (não migration, pois contém URL e chave do projeto).
- Cada envio registra um step `delayed_message` no `automation_log_steps` do log original, reaproveitando `step-logger.server.ts`.
- Validação em `src/lib/automation-rules.ts`: atraso entre 1 minuto e 7 dias; texto máximo de 1000 caracteres (80 se um dia houver botões).
