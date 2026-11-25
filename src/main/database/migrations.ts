import type { Db } from './mysql';

/**
 * Bancos criados antes dos campos de endereço não recebem colunas novas apenas
 * com CREATE TABLE IF NOT EXISTS. Cada ALTER é aplicado na inicialização e o
 * erro de "coluna já existe" é tratado explicitamente, sem usar
 * ADD COLUMN IF NOT EXISTS (não suportado pelo adaptador SQLite dos testes).
 */
const CLIENTES_COLUMN_MIGRATIONS = [
  "ALTER TABLE clientes ADD COLUMN tipo_pessoa VARCHAR(2) NOT NULL DEFAULT 'PF' CHECK (tipo_pessoa IN ('PF', 'PJ'))",
  'ALTER TABLE clientes ADD COLUMN cep VARCHAR(9)',
  'ALTER TABLE clientes ADD COLUMN numero VARCHAR(20)',
];

function isDuplicateColumnError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const details = error as { code?: unknown; errno?: unknown; message?: unknown };
  return (
    details.code === 'ER_DUP_FIELDNAME' || // MySQL/MariaDB
    details.errno === 1060 ||
    (typeof details.message === 'string' && /duplicate column name/i.test(details.message)) // SQLite
  );
}

/** Garante as colunas de cadastro de clientes em bancos novos e já existentes. */
export async function ensureClientesColumns(db: Db): Promise<void> {
  for (const statement of CLIENTES_COLUMN_MIGRATIONS) {
    try {
      await db.exec(statement);
    } catch (error) {
      if (!isDuplicateColumnError(error)) throw error;
    }
  }
}
