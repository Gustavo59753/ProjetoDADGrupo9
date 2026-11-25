import type { LookupResult, PlateData } from '@shared/types';
import { getDb } from '../database/connection';

/** Colunas lidas de `veiculos` para preencher o cadastro pela placa. */
interface PlateRow {
  placa: string;
  marca: string | null;
  modelo: string | null;
  ano_fabricacao: number | null;
  ano_modelo: number | null;
  cor: string | null;
  combustivel: string | null;
  chassi: string | null;
  renavam: string | null;
}

export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidPlate(value: string): boolean {
  return /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/.test(normalizePlate(value));
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value).trim() || null;
}

function nullableYear(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const year = Number(value);
  return Number.isFinite(year) ? year : null;
}

/** Consulta o cadastro local de veículos pela placa normalizada, sem acessar a rede. */
export async function lookupPlate(plate: string): Promise<LookupResult<PlateData>> {
  const placa = normalizePlate(plate);
  if (!isValidPlate(placa)) {
    return { status: 'invalid', message: 'Placa inválida. Use ABC1234 ou ABC1D23.' };
  }

  let row: PlateRow | undefined;
  try {
    // A normalização no lado do banco aceita placa gravada com hífen/espaço ou em minúsculas.
    row = (await getDb().prepare(
      `SELECT placa, marca, modelo, ano_fabricacao, ano_modelo, cor, combustivel, chassi, renavam
         FROM veiculos
        WHERE UPPER(REPLACE(REPLACE(placa, '-', ''), ' ', '')) = ?
        LIMIT 1`
    ).get(placa)) as PlateRow | undefined;
  } catch (error) {
    console.error('[plate] falha ao consultar veiculos:', error);
    return {
      status: 'unavailable',
      message: 'Não foi possível consultar o cadastro de veículos. Tente novamente.',
    };
  }

  if (!row) {
    return {
      status: 'not_found',
      message: 'Placa não encontrada no cadastro de veículos. Preencha os dados manualmente.',
    };
  }

  return {
    status: 'found',
    data: {
      placa,
      marca: nullableText(row.marca),
      modelo: nullableText(row.modelo),
      anoFabricacao: nullableYear(row.ano_fabricacao),
      anoModelo: nullableYear(row.ano_modelo),
      cor: nullableText(row.cor),
      combustivel: nullableText(row.combustivel),
      chassi: nullableText(row.chassi),
      renavam: nullableText(row.renavam),
    },
  };
}
