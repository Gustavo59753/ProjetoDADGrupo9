import type { PersonType } from '@shared/types';
import { isValidCep } from './cep';
import { isValidCnpj, isValidCpf } from './cnpj';

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function personTypeFromInput(input: Record<string, unknown>): PersonType {
  return asText(input.tipo_pessoa).toUpperCase() === 'PJ' ? 'PJ' : 'PF';
}

/** Valida apenas campos efetivamente informados, para não bloquear atualizações parciais. */
export function validateClientInput(input: Record<string, unknown>): void {
  const personType = personTypeFromInput(input);

  const cep = asText(input.cep);
  if (cep && !isValidCep(cep)) {
    throw new Error('CEP inválido. Informe 8 dígitos no formato 00000-000.');
  }

  const document = asText(input.cpf_cnpj);
  if (!document) return;

  if (personType === 'PF' && !isValidCpf(document)) {
    throw new Error('CPF inválido. Confira os dígitos informados.');
  }
  if (personType === 'PJ' && !isValidCnpj(document)) {
    throw new Error('CNPJ inválido. Confira os dígitos informados.');
  }
}
