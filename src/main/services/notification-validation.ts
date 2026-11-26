import type { NotificationChannel } from '@shared/types';
import {
  isValidEmail,
  isValidPhone,
  normalizeDestination,
  normalizeNotificationChannel,
} from '@shared/validation';

const CHANNEL_ERROR = 'Canal inválido. Escolha WhatsApp, SMS ou E-mail.';

function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
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
  const canal = normalizeNotificationChannel(input.canal);
  if (!canal) throw new Error(CHANNEL_ERROR);

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

export interface NormalizedNotificationInput {
  /** Campos para gravação: apenas os enviados pelo renderer, já normalizados. */
  payload: Record<string, unknown>;
  canal: NotificationChannel;
  destino: string;
  mensagem: string;
}

/**
 * Valida contra o registro salvo (quando houver) e devolve valores canônicos,
 * prontos para gravação e para a deep link. Canais como `Email`/`e-mail` viram
 * `E-mail` antes de qualquer validação, persistência ou abertura do app.
 */
export function normalizeNotificationInput(
  input: Record<string, unknown>,
  current?: Record<string, unknown>,
): NormalizedNotificationInput {
  const canal = normalizeNotificationChannel(input.canal ?? current?.canal);
  if (!canal) throw new Error(CHANNEL_ERROR);

  const merged: Record<string, unknown> = { ...(current ?? {}), ...input, canal };
  validateNotificationInput(merged);

  const payload: Record<string, unknown> = { ...input, canal };
  let destino = asText(merged.destino);
  if (input.destino !== undefined) {
    destino = normalizeDestination(canal, destino);
    payload.destino = destino;
  }

  return { payload, canal, destino, mensagem: String(merged.mensagem ?? '') };
}
