import type { NotificationChannel } from './types';

/** Remove tudo que não é dígito; base comum de máscara, validação e normalização. */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Máscara idêntica à dos cadastros: DDD + 8 ou 9 dígitos (máximo 11 no total). */
export function maskPhone(value: string): string {
  // DDI 55 colado em 12/13 dígitos sai antes da máscara; 11 dígitos com 55 é DDD.
  let digits = phoneDigits(value);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  const d = digits.slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (d.length > 10) return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5, 10)}`;
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4, 8)}`;
}

/** Aceita telefones com DDD: 10 dígitos fixos ou 11 dígitos de celular. */
export function isValidPhone(value: string): boolean {
  const length = phoneDigits(value).length;
  return length === 10 || length === 11;
}

/**
 * Dígitos com DDI 55 para wa.me/sms. Números inválidos devolvem '' para que o
 * chamador possa usar o link de fallback (sem destinatário) do WhatsApp.
 */
export function normalizePhone(value: string): string {
  const digits = phoneDigits(value);
  if (!isValidPhone(digits)) return '';
  // 10 dígitos começando com 55 são DDD, não DDI: nesse caso o 55 é prefixado.
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  return `55${digits}`;
}

/** Exige algo@dominio.extensao (aceita .com.br) e não aceita espaços. */
export function isValidEmail(value: string): boolean {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value);
}

/** Valor exibido/gravado no destino: telefone mascarado ou e-mail sem espaços. */
export function normalizeDestination(channel: NotificationChannel, value: string): string {
  const trimmed = value.trim();
  return channel === 'E-mail' ? trimmed : maskPhone(trimmed);
}
