import { ENTITIES } from '@shared/schema';
import type { EntityName, FieldDef } from '@shared/types';
import { getDb } from './connection';
import { ensureAtivoColumns } from './migrations';
import type { Db } from './mysql';

type Row = Record<string, any>;

/**
 * Bancos criados antes do soft delete precisam da coluna ativo antes de qualquer
 * consulta. O guard é por instância de Db e roda uma única vez, sem depender de
 * alterar o fluxo de inicialização (connection.ts).
 */
let migratedDb: Db | null = null;
let migrating: Promise<void> | null = null;

export async function getReadyDb(): Promise<Db> {
  const db = getDb();
  if (migratedDb === db) return db;
  if (!migrating) {
    migrating = ensureAtivoColumns(db).finally(() => {
      migratedDb = db;
      migrating = null;
    });
  }
  await migrating;
  return db;
}

function normalizeValue(field: FieldDef | undefined, value: unknown): unknown {
  // Checkbox primeiro: ativo/importado são NOT NULL, então "" deve virar 0.
  if (field?.type === 'checkbox') return value ? 1 : 0;
  if (value === undefined || value === '') return null;
  if (field?.type === 'number' || field?.type === 'money') {
    const n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  if (field?.type === 'date' && !value) return null;
  return value;
}

function fieldMap(entity: EntityName): Map<string, FieldDef> {
  const map = new Map(ENTITIES[entity].fields.map((f) => [f.key, f]));
  // "ativo" não é campo de formulário, mas precisa da mesma normalização 1/0.
  if (!map.has('ativo')) {
    map.set('ativo', { key: 'ativo', label: 'Ativo', type: 'checkbox' });
  }
  return map;
}

async function friendlyError(error: any, entity?: EntityName): Promise<Error> {
  const message = String(error?.message ?? '');
  if (error?.code === 'ER_DUP_ENTRY' || /duplicate entry|unique constraint failed/i.test(message)) {
    let hint = '';
    if (entity && ENTITIES[entity].columns.includes('ativo')) {
      try {
        const meta = ENTITIES[entity];
        const db = await getReadyDb();
        const duplicatedValue = /Duplicate entry '([^']*)'/i.exec(message)?.[1];
        const cols = meta.columns.filter((c) => c !== meta.primaryKey && c !== 'created_at');
        // Quando o erro traz o valor, procuramos esse valor entre os inativos;
        // caso contrário (SQLite), usamos a existência de qualquer registro inativo.
        const inactive = duplicatedValue
          ? await db.prepare(
              `SELECT ${meta.primaryKey} AS id FROM ${meta.table} WHERE ativo = 0 AND (${cols
                .map((c) => `CAST(${c} AS CHAR) = ?`)
                .join(' OR ')}) LIMIT 1`
            ).get(...cols.map(() => duplicatedValue))
          : await db.prepare(
              `SELECT ${meta.primaryKey} AS id FROM ${meta.table} WHERE ativo = 0 LIMIT 1`
            ).get();
        if (inactive) {
          hint = ' Se o registro estava inativado, reative-o e edite-o em vez de criar um novo.';
        }
      } catch {
        // A dica é auxiliar: nunca substitui a mensagem de duplicidade.
      }
    }
    return new Error(
      'Já existe um registro com esse valor em um campo único (ex.: CPF, placa, código ou número).' + hint
    );
  }
  if (error?.code === 'ER_NO_REFERENCED_ROW_2' || /foreign key constraint/i.test(message)) {
    return new Error('Não é possível salvar: o registro relacionado não existe mais.');
  }
  return error instanceof Error ? error : new Error(message);
}

/** Leitura interna: create/update precisam devolver a linha que acabaram de gravar. */
async function fetchRow(
  entity: EntityName,
  id: number,
  includeInactive = false
): Promise<Row | undefined> {
  const db = await getReadyDb();
  const meta = ENTITIES[entity];
  const joins = meta.joins?.length ? `, ${meta.joins.join(', ')}` : '';
  const activeFilter = includeInactive ? '' : 'e.ativo = 1 AND';
  return db.prepare(
    `SELECT e.*${joins} FROM ${meta.table} e WHERE ${activeFilter} e.${meta.primaryKey} = ?`
  ).get(id);
}

export async function list(entity: EntityName, search = ''): Promise<Row[]> {
  const db = await getReadyDb();
  const meta = ENTITIES[entity];
  const joins = meta.joins?.length ? `, ${meta.joins.join(', ')}` : '';
  const term = search.trim();
  let outerWhere = '';
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

    // Aliases do SELECT só podem ser usados no WHERE da query externa (q).
    outerWhere = ` WHERE (${criteria.join(' OR ')})`;
  }

  // As joins são subqueries no SELECT; o filtro de ativo fica na inner query.
  const inner = `SELECT e.*${joins} FROM ${meta.table} e WHERE e.ativo = 1`;
  const order = meta.defaultOrder.replace(/\be\./g, '');
  const sql = `SELECT * FROM (${inner}) AS q${outerWhere} ORDER BY ${order} LIMIT 500`;
  return db.prepare(sql).all(...params);
}

export async function get(entity: EntityName, id: number): Promise<Row | undefined> {
  return fetchRow(entity, id);
}

export async function create(entity: EntityName, input: Record<string, unknown>): Promise<Row> {
  const db = await getReadyDb();
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
  } catch (error) {
    throw await friendlyError(error, entity);
  }

  const created = await fetchRow(entity, result.lastInsertRowid, true);
  if (!created) throw new Error('Não foi possível carregar o registro recém-criado.');
  return created;
}

export async function update(entity: EntityName, id: number, input: Record<string, unknown>): Promise<Row> {
  const db = await getReadyDb();
  const meta = ENTITIES[entity];
  const fields = fieldMap(entity);
  const entries = Object.entries(input)
    .filter(([key]) => meta.columns.includes(key) && key !== meta.primaryKey && key !== 'created_at')
    .map(([key, value]) => [key, normalizeValue(fields.get(key), value)] as const);

  // Sem ativo no payload, nunca altere um registro inativado. Com ativo (1/0),
  // o chamador pode reativar ou inativar explicitamente.
  const canTouchInactive = Object.prototype.hasOwnProperty.call(input, 'ativo');
  if (!entries.length) return (await fetchRow(entity, id, canTouchInactive))!;

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const activeFilter = canTouchInactive ? '' : ' AND ativo = 1';
  try {
    await db.prepare(`UPDATE ${meta.table} SET ${sets} WHERE ${meta.primaryKey} = ?${activeFilter}`)
      .run(...entries.map(([, v]) => v), id);
  } catch (error) {
    throw await friendlyError(error, entity);
  }

  // Se o input trouxe ativo, a linha pode ter sido reativada e deve ser devolvida.
  return (await fetchRow(entity, id, canTouchInactive))!;
}

export async function remove(entity: EntityName, id: number): Promise<void> {
  const db = await getReadyDb();
  const meta = ENTITIES[entity];
  try {
    // Soft delete: nenhum DELETE físico, então FKs e ON DELETE não são mais aplicáveis aqui.
    await db.prepare(`UPDATE ${meta.table} SET ativo = 0 WHERE ${meta.primaryKey} = ? AND ativo = 1`)
      .run(id);
  } catch (error) {
    throw await friendlyError(error, entity);
  }
}

export async function options(entity: EntityName, labelField = 'id'): Promise<{ id: number; label: string }[]> {
  const db = await getReadyDb();
  const meta = ENTITIES[entity];
  const field = meta.fields.find((f) => f.key === labelField);
  const column = field ? labelField : meta.listColumns[0]?.key ?? 'id';
  return db.prepare(
    `SELECT id, ${column} AS label FROM ${meta.table} WHERE ativo = 1 ORDER BY ${column} LIMIT 500`
  ).all();
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
  await getReadyDb();
  const scalar = async (sql: string): Promise<number> => {
    const row: any = await getDb().prepare(sql).get();
    return Number(row?.n ?? 0);
  };

  return {
    osAbertas: await scalar("SELECT COUNT(*) n FROM ordens_servico WHERE ativo = 1 AND status IN ('ABERTA','EM_ANDAMENTO','AGUARDANDO_PECA')"),
    osProntas: await scalar("SELECT COUNT(*) n FROM ordens_servico WHERE ativo = 1 AND status = 'PRONTA'"),
    veiculos: await scalar('SELECT COUNT(*) n FROM veiculos WHERE ativo = 1'),
    clientes: await scalar('SELECT COUNT(*) n FROM clientes WHERE ativo = 1'),
    estoqueBaixo: await scalar('SELECT COUNT(*) n FROM pecas WHERE ativo = 1 AND quantidade <= estoque_minimo'),
    valorEmOS: await scalar("SELECT COALESCE(SUM(valor_total),0) n FROM ordens_servico WHERE ativo = 1 AND status <> 'CANCELADA'"),
    // list() já filtra ativo = 1 (e as subqueries de join também).
    recentes: (await list('ordens_servico')).slice(0, 6),
    baixoEstoque: (await list('pecas')).filter((p) => Number(p.quantidade) <= Number(p.estoque_minimo)).slice(0, 6),
  };
}
