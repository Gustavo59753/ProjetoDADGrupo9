import type { CnpjData, LookupResult } from '@shared/types';
import { isValidEmail, isValidPhone, maskPhone } from '@shared/validation';
import { fetchLookupJson } from './lookup';

/**
 * Campos extras devolvidos pela Minha Receita. Declarados aqui para que o
 * serviço não dependa da ordem em que `CnpjData` é estendido pelo restante do
 * projeto; continua sendo um subtipo de `CnpjData`.
 */
interface CnpjProviderData extends CnpjData {
  telefone?: string;
  email?: string;
  situacao?: string;
  complemento?: string;
}

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

/** Só aceita DDD + 8/9 dígitos, descartando DDI colado ou valores parciais. */
function providerPhone(value: unknown): string {
  const digits = normalizeDocument(asText(value));
  return isValidPhone(digits) ? maskPhone(digits) : '';
}

function toCnpjData(digits: string, value: unknown): CnpjProviderData | null {
  if (!isRecord(value)) return null;

  const razaoSocial = asText(value.razao_social);
  const nomeFantasia = asText(value.nome_fantasia);
  if (!razaoSocial && !nomeFantasia) return null;

  const email = asText(value.email);
  const telefone = providerPhone(value.ddd_telefone_1)
    || providerPhone(value.ddd_telefone_2)
    || providerPhone(value.ddd_fax);

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
    telefone,
    email: isValidEmail(email) ? email : '',
    situacao: asText(value.descricao_situacao_cadastral),
    complemento: asText(value.complemento),
  };
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Em updates parciais, considera o valor salvo quando o campo não foi enviado. */
function effectiveValue(
  input: Record<string, unknown>,
  current: Record<string, unknown> | undefined,
  key: string,
): unknown {
  return hasOwn(input, key) ? input[key] : current?.[key];
}

/** Endereço resumido da Receita, anexado às observações do fornecedor. */
export function formatSupplierAddress(data: CnpjProviderData): string {
  const logradouro = [data.logradouro, data.numero].filter(Boolean).join(', ');
  const localidade = [data.cidade, data.uf].filter(Boolean).join('/');
  const partes = [logradouro, data.complemento, data.bairro, localidade].filter(Boolean);
  if (!partes.length) return '';
  const cep = data.cep ? `, CEP ${data.cep}` : '';
  return `Endereço (Minha Receita): ${partes.join(' - ')}${cep}.`;
}

/** Erro amigável para cada falha da consulta ao cadastro de fornecedores. */
function supplierLookupError(status: 'invalid' | 'not_found' | 'unavailable'): string {
  if (status === 'invalid') {
    return 'CNPJ inválido. Confira os dígitos informados antes de salvar o fornecedor.';
  }
  if (status === 'not_found') {
    return 'CNPJ não encontrado na Receita Federal. Confira o número informado antes de salvar o fornecedor.';
  }
  return 'Não foi possível validar o CNPJ na Receita Federal agora. Tente novamente em instantes antes de salvar o fornecedor.';
}

/**
 * Valida o CNPJ informado no cadastro de fornecedores e aproveita os dados da
 * consulta para preencher campos vazios. Consulta pulada quando o CNPJ não muda,
 * para não bloquear a edição de outros campos numa queda de rede.
 */
export async function prepareSupplierInput(
  input: Record<string, unknown>,
  current?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = { ...input };
  if (!hasOwn(input, 'cnpj') || isBlank(input.cnpj)) return payload;

  const cnpj = String(input.cnpj).trim();
  const cnpjAtual = current?.cnpj;
  if (
    current &&
    !isBlank(cnpjAtual) &&
    normalizeDocument(String(cnpjAtual)) === normalizeDocument(cnpj)
  ) {
    return payload;
  }

  const resultado = await lookupCnpj(cnpj);
  if (resultado.status !== 'found') {
    throw new Error(supplierLookupError(resultado.status));
  }

  const { data } = resultado;
  if (isBlank(effectiveValue(payload, current, 'razao_social'))) {
    payload.razao_social = data.razao_social || data.nome_fantasia;
  }
  if (isBlank(effectiveValue(payload, current, 'pais'))) {
    payload.pais = 'Brasil';
  }
  if (isBlank(effectiveValue(payload, current, 'telefone')) && data.telefone) {
    payload.telefone = data.telefone;
  }
  if (isBlank(effectiveValue(payload, current, 'email')) && data.email) {
    payload.email = data.email;
  }

  const nomeFantasia = String(data.nome_fantasia ?? '').trim();
  const razaoSocial = String(effectiveValue(payload, current, 'razao_social') ?? '').trim();
  if (
    nomeFantasia &&
    nomeFantasia !== razaoSocial &&
    isBlank(effectiveValue(payload, current, 'contato'))
  ) {
    payload.contato = nomeFantasia;
  }

  const endereco = formatSupplierAddress(data);
  if (endereco) {
    const observacao = effectiveValue(payload, current, 'observacoes');
    const base = isBlank(observacao) ? '' : String(observacao).trim();
    // O renderer já grava essas linhas ao consultar o CNPJ no formulário.
    const jaTemEndereco = base.includes('Endereço (Minha Receita):');
    if (!jaTemEndereco && !base.includes(endereco)) {
      payload.observacoes = base ? `${base}\n${endereco}` : endereco;
    }
  }

  return payload;
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
