import { shell } from 'electron';
import type { NotificationChannel } from '@shared/types';
import { isValidPhone, normalizePhone } from '@shared/validation';

export interface DeliveryLinkResult {
  status: 'ABERTO_NO_WHATSAPP' | 'ABERTO_NO_APP';
  link: string;
}

/** Monta a deep link do app nativo correspondente ao canal, sem chamar o SO. */
export function buildDeliveryLink(
  channel: NotificationChannel,
  destino: string,
  mensagem: string,
): DeliveryLinkResult {
  const text = encodeURIComponent(mensagem);

  if (channel === 'WhatsApp') {
    const phone = isValidPhone(destino) ? normalizePhone(destino) : '';
    return {
      status: 'ABERTO_NO_WHATSAPP',
      link: phone
        ? `https://wa.me/${phone}?text=${text}`
        : `https://api.whatsapp.com/send?text=${text}`,
    };
  }

  if (channel === 'SMS') {
    return {
      status: 'ABERTO_NO_APP',
      link: `sms:${normalizePhone(destino)}?body=${text}`,
    };
  }

  return {
    status: 'ABERTO_NO_APP',
    link: `mailto:${destino.trim()}?subject=${encodeURIComponent('Aviso da oficina')}&body=${text}`,
  };
}

/** Abre a deep link uma única vez e devolve o status que deve ser persistido. */
export async function deliverNotification(
  channel: NotificationChannel,
  destino: string,
  mensagem: string,
): Promise<DeliveryLinkResult> {
  const result = buildDeliveryLink(channel, destino, mensagem);
  await shell.openExternal(result.link);
  return result;
}
