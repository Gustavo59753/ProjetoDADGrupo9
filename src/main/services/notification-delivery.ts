import { shell } from 'electron';
import type { NotificationChannel } from '@shared/types';
import { isValidPhone, normalizeNotificationChannel, normalizePhone } from '@shared/validation';

export interface DeliveryLinkResult {
  status: 'ABERTO_NO_WHATSAPP' | 'ABERTO_NO_APP';
  link: string;
}

const DEFAULT_SUBJECT = 'Aviso da oficina';

/** Monta a deep link do app nativo correspondente ao canal, sem chamar o SO. */
export function buildDeliveryLink(
  channel: NotificationChannel,
  destino: string,
  mensagem: string,
  assunto?: string,
): DeliveryLinkResult {
  // Defensivo: canal já vem normalizado do boundary, mas a normalização também
  // vale para chamadas diretas a este serviço.
  const canonico = normalizeNotificationChannel(channel) ?? channel;
  const text = encodeURIComponent(mensagem);

  if (canonico === 'WhatsApp') {
    const phone = isValidPhone(destino) ? normalizePhone(destino) : '';
    return {
      status: 'ABERTO_NO_WHATSAPP',
      link: phone
        ? `https://wa.me/${phone}?text=${text}`
        : `https://api.whatsapp.com/send?text=${text}`,
    };
  }

  if (canonico === 'SMS') {
    return {
      status: 'ABERTO_NO_APP',
      link: `sms:${normalizePhone(destino)}?body=${text}`,
    };
  }

  const to = destino.trim();
  if (!to) throw new Error('Destino é obrigatório para abrir o aviso por e-mail.');

  const subject = assunto?.trim() || DEFAULT_SUBJECT;
  return {
    status: 'ABERTO_NO_APP',
    link: `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${text}`,
  };
}

/** Abre a deep link uma única vez e devolve o status que deve ser persistido. */
export async function deliverNotification(
  channel: NotificationChannel,
  destino: string,
  mensagem: string,
  assunto?: string,
): Promise<DeliveryLinkResult> {
  const result = buildDeliveryLink(channel, destino, mensagem, assunto);
  await shell.openExternal(result.link);
  return result;
}
