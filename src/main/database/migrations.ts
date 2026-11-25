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

/** CHECK atualizado: avisos via SMS/E-mail podem abrir o app nativo; WhatsApp mantém o próprio. */
const NOTIFICACOES_STATUS_MODIFY =
  "ALTER TABLE notificacoes MODIFY COLUMN status VARCHAR(24) NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','ABERTO_NO_WHATSAPP','ABERTO_NO_APP','ENVIADO','FALHA'))";

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (typeof error !== 'object' || error === null) return '';
  const details = error as { message?: unknown };
  return typeof details.message === 'string' ? details.message : '';
}

/** Nome exato do CHECK declarado no schema.sql do projeto. */
const NOTIFICACOES_STATUS_CHECK_NAME = 'chk_notificacoes_status';

/**
 * Lê o DDL atual de notificacoes sem depender de INFORMATION_SCHEMA, cujo
 * catálogo é limitado em alguns servidores MySQL. Retorna null quando o
 * comando não estiver disponível (SQLite do smoke-test, por exemplo).
 */
async function readNotificacoesCreateTable(db: Db): Promise<string | null> {
  try {
    const row = await db.prepare('SHOW CREATE TABLE notificacoes').get() as
      | Record<string, unknown>
      | null
      | undefined;
    if (!row || typeof row !== 'object') return null;
    // MySQL devolve a coluna como "Create Table"; outros adapters podem variar.
    const ddl = Object.values(row).find(
      (value) => typeof value === 'string' && /\bCREATE\s+TABLE\b/i.test(value)
    );
    return typeof ddl === 'string' ? ddl : null;
  } catch (error) {
    console.warn(`[migration] SHOW CREATE TABLE indisponível: ${errorMessage(error)}`);
    return null;
  }
}

/** Executa um passo da migration sem nunca interromper a inicialização. */
async function tryMigrationStatement(db: Db, description: string, sql: string): Promise<boolean> {
  try {
    await db.exec(sql);
    return true;
  } catch (error) {
    console.warn(`[migration] ${description} não aplicado em notificacoes: ${errorMessage(error)}`);
    return false;
  }
}

/** Atualiza o CHECK de status em bancos existentes sem alterar os status legados. */
export async function ensureNotificacoesStatus(db: Db): Promise<void> {
  const ddl = await readNotificacoesCreateTable(db);
  // Banco novo/já migrado: não reconstrói a tabela a cada inicialização.
  if (ddl && /ABERTO_NO_APP/i.test(ddl)) return;

  // MySQL 8 não permite MODIFY de coluna usada por CHECK sem remover o antigo.
  // A sintaxe DROP CHECK é aceita por MariaDB; MySQL 8 prefere DROP CONSTRAINT.
  const checkRemoved = await tryMigrationStatement(
    db,
    'DROP CHECK',
    `ALTER TABLE notificacoes DROP CHECK \`${NOTIFICACOES_STATUS_CHECK_NAME}\``
  );
  if (!checkRemoved) {
    await tryMigrationStatement(
      db,
      'DROP CONSTRAINT',
      `ALTER TABLE notificacoes DROP CONSTRAINT \`${NOTIFICACOES_STATUS_CHECK_NAME}\``
    );
  }
  await tryMigrationStatement(db, 'MODIFY COLUMN', NOTIFICACOES_STATUS_MODIFY);
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
