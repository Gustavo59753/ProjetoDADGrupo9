import { isValidEmail } from '@shared/validation';

/**
 * Valida o e-mail apenas quando informado. Ausência, null e string vazia são
 * permitidos para não bloquear cadastros opcionais nem atualizações parciais.
 */
export function validateEmailInput(input: Record<string, unknown>): void {
  const value = input.email;
  if (value === undefined || value === null || value === '') return;

  if (!isValidEmail(String(value).trim())) {
    throw new Error('E-mail inválido. Informe um endereço como cliente@exemplo.com.');
  }
}
