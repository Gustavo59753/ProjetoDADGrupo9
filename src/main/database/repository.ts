import { ENTITIES } from '@shared/schema';
import type { EntityName, FieldDef } from '@shared/types';
import { getDb } from './connection';

type Row = Record<string, any>;

function normalizeValue(field: FieldDef | undefined, value: unknown): unknown {
  if (value === undefined) return null;
  if (value === '') return null;
  if (field?.type === 'checkbox') return value ? 1 : 0;
  if (field?.type === 'number' || field?.type === 'money') {
    const n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  if (field?.type === 'date' && !value) return null;
  return value;
}

function fieldMap(entity: EntityName): Map<string, FieldDef> {
  return new Map(ENTITIES[entity].fields.map((f) => [f.key, f]));
}

function friendlyError(error: any): Error {
  const message = String(error?.message ?? '');
  if (error?.code === 'ER_DUP_ENTRY' || /duplicate entry/i.test(message)) {
    return new Error('Já existe um registro com esse valor em um campo único (ex.: CPF, placa, código ou número).');
  }
  if (error?.code === 'ER_NO_REFERENCED_ROW_2' || /foreign key constraint/i.test(message)) {
    return new Error('Não é possível salvar: o registro relacionado não existe mais.');
  }
  return error instanceof Error ? error : new Error(message);
}

export async function list(entity: EntityName, search = ''): Promise<Row[]> {
  const db = getDb();
  const meta = ENTITIES[entity];
  const joins = meta.joins?.length ? `, ${meta.joins.join(', ')}` : '';
  const term = search.trim();
  let where = '';
  const params: unknown[] = [];

  if (term) {
    const cols = [...meta.searchColumns];
    // Permite buscar também nos rótulos trazidos pelas FK (ex.: nome do cliente)
    for (const expr of meta.joins ?? []) {
      const alias = expr.match(/AS\s+(\w+)\s*$/i)?.[1];
      if (alias) cols.push(alias);
    }
    const criteria = cols.map((c) => `COALESCE(${c}, '') LIKE ?`);
    cols.forEach(() => params.push(`%${term}%`));

    if (entity === 'notificacoes' && /^\d+$/.test(term)) {
      // Avisos gravam o telefone mascarado: compara sem ( ) espaço e - (válido em MySQL e SQLite).
      const unmasked = `REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(q.destino, ''), '(', ''), ')', ''), ' ', ''), '-', '')`;
      criteria.push(`${unmasked} LIKE ?`);
      params.push(`%${term}%`);
      if (/^55\d{10,11}$/.test(term)) {
        // Termo com DDI 55 também encontra o número salvo sem o prefixo.
        criteria.push(`${unmasked} LIKE ?`);
        params.push(`%${term.slice(2)}%`);
      }
    }

    where = ` WHERE (${criteria.join(' OR ')})`;
  }

  // A subquery externa é necessária porque o MySQL não aceita aliases do SELECT no WHERE.
  const inner = `SELECT e.*${joins} FROM ${meta.table} e`;
  const order = meta.defaultOrder.replace(/\be\./g, '');
  const sql = `SELECT * FROM (${inner}) AS q${where} ORDER BY ${order} LIMIT 500`;
  return db.prepare(sql).all(...params);
}

export async function get(entity: EntityName, id: number): Promise<Row | undefined> {
  const db = getDb();
  const meta = ENTITIES[entity];
  const joins = meta.joins?.length ? `, ${meta.joins.join(', ')}` : '';
  return db.prepare(`SELECT e.*${joins} FROM ${meta.table} e WHERE e.${meta.primaryKey} = ?`).get(id);
}

export async function create(entity: EntityName, input: Record<string, unknown>): Promise<Row> {
  const db = getDb();
  const meta = ENTITIES[entity];
  const fields = fieldMap(entity);
  const entries = Object.entries(input)
    .filter(([key]) => meta.columns.includes(key) && key !== meta.primaryKey && key !== 'created_at')
    .map(([key, value]) => [key, normalizeValue(fields.get(key), value)] as const);

  if (!entries.length) throw new Error('Nenhum dado válido foi informado.');

  const cols = entries.map(([k]) => k).join(', ');
  const marks = entries.map(() => '?').join(', ');
  let result: { lastInsertRowid: number };
  try {
    result = await db.prepare(`INSERT INTO ${meta.table} (${cols}) VALUES (${marks})`)
      .run(...entries.map(([, v]) => v));
  } catch (error: any) {
    throw friendlyError(error);
  }

  return (await get(entity, result.lastInsertRowid))!;
}

export async function update(entity: EntityName, id: number, input: Record<string, unknown>): Promise<Row> {
  const db = getDb();
  const meta = ENTITIES[entity];
  const fields = fieldMap(entity);
  const entries = Object.entries(input)
    .filter(([key]) => meta.columns.includes(key) && key !== meta.primaryKey && key !== 'created_at')
    .map(([key, value]) => [key, normalizeValue(fields.get(key), value)] as const);

  if (!entries.length) return (await get(entity, id))!;

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  try {
    await db.prepare(`UPDATE ${meta.table} SET ${sets} WHERE ${meta.primaryKey} = ?`)
      .run(...entries.map(([, v]) => v), id);
  } catch (error: any) {
    throw friendlyError(error);
  }

  return (await get(entity, id))!;
}

export async function remove(entity: EntityName, id: number): Promise<void> {
  const db = getDb();
  const meta = ENTITIES[entity];
  try {
    await db.prepare(`DELETE FROM ${meta.table} WHERE ${meta.primaryKey} = ?`).run(id);
  } catch (error: any) {
    if (error?.code === 'ER_ROW_IS_REFERENCED_2' || /foreign key constraint/i.test(error?.message ?? '')) {
      throw new Error(
        `Não é possível excluir este ${meta.singular.toLowerCase()}: existem registros vinculados a ele.`
      );
    }
    throw error;
  }
}

export async function options(entity: EntityName, labelField = 'id'): Promise<{ id: number; label: string }[]> {
  const db = getDb();
  const meta = ENTITIES[entity];
  const field = meta.fields.find((f) => f.key === labelField);
  const column = field ? labelField : meta.listColumns[0]?.key ?? 'id';
  return db.prepare(`SELECT id, ${column} AS label FROM ${meta.table} ORDER BY ${column} LIMIT 500`).all();
}

export interface DashboardStats {
  osAbertas: number;
  osProntas: number;
  veiculos: number;
  clientes: number;
  estoqueBaixo: number;
  valorEmOS: number;
  recentes: Row[];
  baixoEstoque: Row[];
}

export async function dashboard(): Promise<DashboardStats> {
  const db = getDb();
  const scalar = async (sql: string): Promise<number> => {
    const row: any = await db.prepare(sql).get();
    return Number(row?.n ?? 0);
  };

  return {
    osAbertas: await scalar("SELECT COUNT(*) n FROM ordens_servico WHERE status IN ('ABERTA','EM_ANDAMENTO','AGUARDANDO_PECA')"),
    osProntas: await scalar("SELECT COUNT(*) n FROM ordens_servico WHERE status = 'PRONTA'"),
    veiculos: await scalar('SELECT COUNT(*) n FROM veiculos'),
    clientes: await scalar('SELECT COUNT(*) n FROM clientes'),
    estoqueBaixo: await scalar('SELECT COUNT(*) n FROM pecas WHERE quantidade <= estoque_minimo'),
    valorEmOS: await scalar("SELECT COALESCE(SUM(valor_total),0) n FROM ordens_servico WHERE status <> 'CANCELADA'"),
    recentes: (await list('ordens_servico')).slice(0, 6),
    baixoEstoque: (await list('pecas')).filter((p) => Number(p.quantidade) <= Number(p.estoque_minimo)).slice(0, 6),
  };
}
