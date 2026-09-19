import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { decryptString } from '@/server/crypto.server';
import { zernioFetch } from '@/server/zernio.server';
import type { StepLogger } from '@/lib/step-logger.server';

type Automation = Database['public']['Tables']['automations']['Row'];
export async function zernioGetProfileId(apiKey: string, accountId: string) {
  const data = await zernioFetch<{ accounts?: { _id: string; profileId?: string | { _id: string } }[] }>({ apiKey, path: '/accounts' });
  const profile = data.accounts?.find(a => a._id === accountId)?.profileId;
  const id = typeof profile === 'string' ? profile : profile?._id;
  if (!id) throw new Error('Perfil da conta Instagram não encontrado na Zernio');
  return id;
}

export async function syncSequence(db: SupabaseClient<Database>, row: Automation): Promise<string | null> {
  if (!row.delayed_enabled && !row.zernio_sequence_id) return null;
  try {
    const { data: settings, error } = await db.from('user_settings').select('zernio_api_key_encrypted,zernio_account_id').eq('user_id', row.user_id).single();
    if (error || !settings?.zernio_api_key_encrypted || !settings.zernio_account_id) throw new Error('Configure a conta Zernio antes de ativar a mensagem atrasada');
    const apiKey = decryptString(settings.zernio_api_key_encrypted);
    let id = row.zernio_sequence_id;
    if (row.delayed_enabled) {
      const body = { name: row.name, steps: [{ order: 1, delayMinutes: row.delayed_delay_minutes, message: { text: row.delayed_message } }], exitOnReply: row.delayed_exit_on_reply, exitOnUnsubscribe: true };
      if (id) {
        // Zernio only allows changing steps while the sequence is draft or paused.
        await zernioFetch({ apiKey, path: `/sequences/${encodeURIComponent(id)}/pause`, method: 'POST' });
        await zernioFetch({ apiKey, path: `/sequences/${encodeURIComponent(id)}`, method: 'PATCH', body });
      } else {
        const result = await zernioFetch<{ sequence?: { id?: string } }>({ apiKey, path: '/sequences', method: 'POST', body: { ...body, profileId: await zernioGetProfileId(apiKey, settings.zernio_account_id), accountId: settings.zernio_account_id, platform: 'instagram' } });
        id = result.sequence?.id ?? null;
        if (!id) throw new Error('Zernio não retornou o identificador da sequência');
        const saved = await db.from('automations').update({ zernio_sequence_id: id }).eq('id', row.id);
        if (saved.error) throw new Error(saved.error.message);
      }
    }
    if (id) await zernioFetch({ apiKey, path: `/sequences/${encodeURIComponent(id)}/${row.delayed_enabled && row.is_active ? 'activate' : 'pause'}`, method: 'POST' });
    return null;
  } catch {
    // Avoid exposing upstream payloads or credentials through UI errors.
    return 'Automação salva, mas a sequência não foi sincronizada na Zernio. Verifique a conexão e salve novamente; envios já agendados podem manter a configuração anterior.';
  }
}

async function resolveContact(apiKey: string, accountId: string, participantId: string) {
  const lookup = async () => {
    for (let skip = 0; ; skip += 200) {
      const page = await zernioFetch<{ contacts?: { id: string; platformIdentifier?: string }[]; pagination?: { hasMore?: boolean } }>({ apiKey, path: `/contacts?accountId=${encodeURIComponent(accountId)}&platform=instagram&limit=200&skip=${skip}` });
      const found = page.contacts?.find(c => c.platformIdentifier === participantId);
      if (found) return found.id;
      if (!page.pagination?.hasMore) return null;
      if (skip >= 9800) throw new Error('Contato não localizado; envie uma DM para vincular o contato da Zernio');
    }
  };
  const existing = await lookup();
  if (existing) return existing;
  try {
    const result = await zernioFetch<{ contact?: { id?: string } }>({ apiKey, path: '/contacts', method: 'POST', body: { profileId: await zernioGetProfileId(apiKey, accountId), name: participantId, accountId, platform: 'instagram', platformIdentifier: participantId } });
    if (!result.contact?.id) throw new Error('Zernio não retornou o contato');
    return result.contact.id;
  } catch (error) {
    if ((error as { apiStatus?: number }).apiStatus === 409) {
      const found = await lookup();
      if (found) return found;
    }
    throw error;
  }
}

export async function enrollDelayedMessage(input: { automation: Automation; apiKey: string; accountId: string; participantId: string; contactId?: string; logger: StepLogger }) {
  const { automation, apiKey, accountId, logger } = input;
  if (!automation.delayed_enabled || !automation.is_active) return;
  const step = await logger.step('sequence_enroll', 'Inscrevendo na sequência', { delay_minutes: automation.delayed_delay_minutes });
  try {
    if (!automation.zernio_sequence_id) throw new Error('Sequência não sincronizada. Salve a automação novamente.');
    if (!input.participantId && !input.contactId) throw new Error('Participante não identificado');
    const contactId = input.contactId || await resolveContact(apiKey, accountId, input.participantId);
    const sequencePath = `/sequences/${encodeURIComponent(automation.zernio_sequence_id)}`;
    type EnrollmentResult = {
      enrolled?: number;
      failed?: number;
      results?: { contactId?: string; success?: boolean; error?: string }[];
      success?: boolean;
    };
    const enroll = () => zernioFetch<EnrollmentResult>({
      apiKey,
      path: `${sequencePath}/enroll`,
      method: 'POST',
      body: { contactIds: [contactId] },
    });

    let result = await enroll();
    const contactResult = result.results?.find(item => item.contactId === contactId) ?? result.results?.[0];
    const alreadyEnrolled = contactResult?.success === false && contactResult.error?.toLowerCase().includes('already enrolled');

    if (alreadyEnrolled) {
      // Zernio keeps a contact enrolled after a previous trigger. Remove the old
      // enrollment so a new trigger starts a fresh delay from this moment.
      await zernioFetch({
        apiKey,
        path: `${sequencePath}/enroll/${encodeURIComponent(contactId)}`,
        method: 'DELETE',
      });
      result = await enroll();
    }

    const failedResult = result.results?.find(item => item.success === false);
    if ((result.failed ?? 0) > 0 || failedResult) {
      throw new Error(failedResult?.error || 'A Zernio recusou a inscrição na sequência');
    }
    await step.success({ apiResponse: result });
  } catch (error) {
    await step.fail(error);
  }
}
