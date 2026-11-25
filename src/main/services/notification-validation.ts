import type { NotificationChannel } from '@shared/types';
import { isValidEmail, isValidPhone } from '@shared/validation';

const CHANNELS: readonly NotificationChannel[] = ['WhatsApp', 'SMS', 'E-mail'];

function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function isChannel(value: string): value is NotificationChannel {
  return (CHANNELS as readonly string[]).includes(value);
}

/** Mesmo critério da máscara: DDI 55 colado em 12/13 dígitos não conta como DDD. */
function phoneForValidation(value: string): string {
  const digits = asText(value).replace(/\D/g, '');
  return (digits.length === 12 || digits.length === 13) && digits.startsWith('55')
    ? digits.slice(2)
    : digits;
}

/** Validação de fronteira: nada que venha do renderer chega ao shell sem passar por aqui. */
export function validateNotificationInput(input: Record<string, unknown>): void {
  const canal = asText(input.canal);
  if (!isChannel(canal)) {
    throw new Error('Canal inválido. Escolha WhatsApp, SMS ou E-mail.');
  }

  const mensagem = asText(input.mensagem);
  if (!mensagem) {
    throw new Error('Mensagem é obrigatória. Descreva o aviso antes de salvar.');
  }

  const destino = asText(input.destino);
  if (!destino) {
    throw new Error('Destino é obrigatório. Informe o telefone ou o e-mail do cliente.');
  }

  if (canal === 'E-mail') {
    if (!isValidEmail(destino)) {
      throw new Error('E-mail inválido. Informe um endereço como cliente@exemplo.com.');
    }
    return;
  }

  if (!isValidPhone(phoneForValidation(destino))) {
    throw new Error('Telefone inválido. Informe o DDD e o número com 10 ou 11 dígitos.');
  }
}
