import type { LookupResult, PlateData, PlateOrdemServico } from '@shared/types';
import { getReadyDb } from '../database/repository';

/** Colunas lidas de `veiculos` para preencher o cadastro pela placa. */
interface PlateRow {
  id: number;
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

/** Colunas lidas de `ordens_servico` para o histórico do veículo. */
interface PlateOrderRow {
  id: number;
  numero: string;
  data_entrada: unknown;
  data_saida: unknown;
  status: string;
  descricao_problema: string | null;
  valor_total: number | string | null;
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

/** Datas vêm como Date (MySQL) ou string (SQLite no smoke test); devolvemos YYYY-MM-DD. */
function nullableDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  const text = String(value).trim();
  return text ? text.slice(0, 10) : null;
}

function nullableNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** Consulta o cadastro local de veículos pela placa normalizada, sem acessar a rede. */
export async function lookupPlate(plate: string): Promise<LookupResult<PlateData>> {
  const placa = normalizePlate(plate);
  if (!isValidPlate(placa)) {
    return { status: 'invalid', message: 'Placa inválida. Use ABC1234 ou ABC1D23.' };
  }

  let row: PlateRow | undefined;
  let orderRows: PlateOrderRow[] = [];
  try {
    const db = await getReadyDb();
    // A normalização no lado do banco aceita placa gravada com hífen/espaço ou em minúsculas.
    row = (await db.prepare(
      `SELECT v.id, v.placa, v.marca, v.modelo, v.ano_fabricacao, v.ano_modelo, v.cor, v.combustivel, v.chassi, v.renavam
         FROM veiculos v
        WHERE UPPER(REPLACE(REPLACE(v.placa, '-', ''), ' ', '')) = ?
          AND v.ativo = 1
        LIMIT 1`
    ).get(placa)) as PlateRow | undefined;

    if (row) {
      orderRows = (await db.prepare(
        `SELECT o.id, o.numero, o.data_entrada, o.data_saida, o.status, o.descricao_problema, o.valor_total
           FROM ordens_servico o
          WHERE o.veiculo_id = ? AND o.ativo = 1
          ORDER BY o.data_entrada DESC, o.id DESC
          LIMIT 50`
      ).all(Number(row.id))) as PlateOrderRow[];
    }
  } catch (error) {
    console.error('[plate] falha ao consultar veiculos/ordens_servico:', error);
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

  const ordensServico: PlateOrdemServico[] = orderRows.map((order) => ({
    id: Number(order.id),
    numero: nullableText(order.numero) ?? '',
    dataEntrada: nullableDate(order.data_entrada),
    dataSaida: nullableDate(order.data_saida),
    status: nullableText(order.status) ?? '',
    descricaoProblema: nullableText(order.descricao_problema),
    valorTotal: nullableNumber(order.valor_total),
  }));

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
      ordensServico,
    },
  };
}
