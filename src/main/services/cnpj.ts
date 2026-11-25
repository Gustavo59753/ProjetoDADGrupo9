import type { CnpjData, LookupResult } from '@shared/types';
import { fetchLookupJson } from './lookup';

export function normalizeDocument(value: string): string {
  return value.replace(/\D/g, '');
}

function checkDigit(base: string, weights: readonly number[]): number {
  const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCpf(value: string): boolean {
  const digits = normalizeDocument(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;

  return Number(digits[9]) === checkDigit(digits.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2])
    && Number(digits[10]) === checkDigit(digits.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
}

export function isValidCnpj(value: string): boolean {
  const digits = normalizeDocument(value);
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;

  return Number(digits[12]) === checkDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    && Number(digits[13]) === checkDigit(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCnpjData(digits: string, value: unknown): CnpjData | null {
  if (!isRecord(value)) return null;

  const razaoSocial = asText(value.razao_social);
  const nomeFantasia = asText(value.nome_fantasia);
  if (!razaoSocial && !nomeFantasia) return null;

  return {
    cnpj: asText(value.cnpj) || digits,
    razao_social: razaoSocial || nomeFantasia,
    nome_fantasia: nomeFantasia,
    logradouro: asText(value.logradouro),
    numero: asText(value.numero),
    bairro: asText(value.bairro),
    // A Minha Receita devolve o município em `municipio`, não em `cidade`.
    cidade: asText(value.cidade) || asText(value.municipio),
    uf: asText(value.uf),
    cep: normalizeDocument(asText(value.cep)),
  };
}

/** Consulta a Minha Receita (https://minhareceita.org) sem cache: falha de rede nunca bloqueia. */
export async function lookupCnpj(cnpj: string): Promise<LookupResult<CnpjData>> {
  if (!isValidCnpj(cnpj)) {
    return { status: 'invalid', message: 'CNPJ inválido. Confira os dígitos informados.' };
  }

  const result = await fetchLookupJson(`https://minhareceita.org/${normalizeDocument(cnpj)}`);
  if (result.status === 'unavailable') {
    return {
      status: 'unavailable',
      message: 'Não foi possível consultar o CNPJ agora. Você pode preencher os dados manualmente.',
    };
  }
  if (result.status === 'not_found') {
    return { status: 'not_found', message: 'CNPJ não encontrado. Confira o número informado.' };
  }

  const data = toCnpjData(normalizeDocument(cnpj), result.json);
  if (!data) {
    return { status: 'unavailable', message: 'O serviço de CNPJ respondeu de forma inesperada. Tente novamente mais tarde.' };
  }

  return { status: 'found', data };
}
