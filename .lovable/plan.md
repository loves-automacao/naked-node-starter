## Aviso visual de limite de caracteres no formulário

O erro `Template element title is required and must be 80 characters or less` acontece porque, quando há **botões nativos**, o Instagram usa o campo `followup_message` como *título do template* — que tem limite de **80 caracteres**. Hoje o campo não mostra esse limite, então o usuário digita mensagens longas sem perceber.

### Mudanças em `src/components/automation-form.tsx`

1. **Follow-up (`followup_message`)**
   - Adicionar contador `X/80` no canto do label quando houver botões nativos configurados (`form.buttons.length > 0`).
   - Quando não houver botões: contador some (não há limite prático).
   - Ao ultrapassar 80 chars **com botões**: contador em vermelho + texto de aviso abaixo do textarea: *"Com botões nativos, a mensagem precisa ter até 80 caracteres (limite do Instagram)."*
   - Aplicar `maxLength={80}` apenas quando `form.buttons.length > 0` para bloquear na digitação.

2. **Quick replies (título do botão)**
   - Já tem `maxLength={20}`, mas sem feedback visual. Adicionar contador `X/20` ao lado de cada input.

3. **Botões nativos (título)**
   - Já tem `maxLength={20}`. Adicionar contador `X/20` ao lado do input do título.

4. **Submit guard**
   - No `handleSubmit`, se `buttons.length > 0 && followup_message.length > 80`: `toast.error` e não envia (evita chegar à API).

### Detalhes técnicos

- Sem mudanças em backend / server / logs — o backend já valida e trunca (mudança da rodada anterior). Este passo é puramente UI para prevenir o erro na origem.
- Contadores implementados como `<span className="text-xs text-muted-foreground">` com classe condicional `text-destructive` quando excede.
- Nenhum arquivo novo. Só edições em `src/components/automation-form.tsx`.

### Validação

- Digitar 90 chars no follow-up com 1 botão nativo → contador fica vermelho, botão de salvar bloqueia com toast.
- Remover todos os botões → contador some, campo aceita texto longo normalmente.
- Contador nos quick replies e títulos de botões atualiza ao digitar.
