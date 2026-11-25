import type { CepData, LookupResult } from '@shared/types';
import { fetchLookupJson } from './lookup';

export function normalizeCep(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidCep(value: string): boolean {
  return /^\d{8}$/.test(normalizeCep(value));
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCepData(value: unknown): CepData | null {
  if (!isRecord(value)) return null;

  const cep = asText(value.cep);
  const localidade = asText(value.localidade);
  const uf = asText(value.uf);
  if (!cep || !localidade || !uf) return null;

  const data: CepData = {
    cep,
    logradouro: asText(value.logradouro),
    bairro: asText(value.bairro),
    localidade,
    uf,
  };

  for (const key of ['complemento', 'ibge', 'gia', 'ddd', 'siafi'] as const) {
    const text = asText(value[key]);
    if (text) data[key] = text;
  }

  return data;
}

/** Consulta o ViaCEP sem cache: falha de rede e CEP não encontrado nunca bloqueiam o cadastro. */
export async function lookupCep(cep: string): Promise<LookupResult<CepData>> {
  if (!isValidCep(cep)) {
    return { status: 'invalid', message: 'CEP inválido. Informe 8 dígitos no formato 00000-000; não é possível cadastrar com este CEP.' };
  }

  const result = await fetchLookupJson(`https://viacep.com.br/ws/${normalizeCep(cep)}/json/`);
  if (result.status === 'unavailable') {
    return {
      status: 'unavailable',
      message: 'Não foi possível consultar o CEP agora. Você pode preencher o endereço manualmente.',
    };
  }
  if (result.status === 'not_found') {
    return { status: 'not_found', message: 'CEP não encontrado. Confira os dígitos informados ou preencha o endereço manualmente.' };
  }

  if (isRecord(result.json) && result.json.erro === true) {
    return { status: 'not_found', message: 'CEP não encontrado. Confira os dígitos informados ou preencha o endereço manualmente.' };
  }

  const data = toCepData(result.json);
  if (!data) {
    return { status: 'unavailable', message: 'O serviço de CEP respondeu de forma inesperada. Tente novamente mais tarde.' };
  }

  return { status: 'found', data };
}
