import { readDbConfig } from '../config';
import schemaSql from './schema.sql?raw';
import { Db } from './mysql';

let database: Db | null = null;

/** Conecta no MySQL/MariaDB configurado no .env e garante a estrutura das tabelas. */
export async function initDb(): Promise<void> {
  if (database) return;

  const config = readDbConfig();
  try {
    const db = await Db.connect(config);
    await db.exec(schemaSql);
    database = db;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Não foi possível conectar ao banco ${config.database} em ${config.host}:${config.port} ` +
      `como ${config.user}. Confira o .env e se o MySQL/MariaDB está ativo. Detalhe: ${detail}`
    );
  }
}

export function getDb(): Db {
  if (!database) {
    throw new Error('Banco de dados não inicializado. Verifique a configuração do .env.');
  }
  return database;
}

export async function closeDb(): Promise<void> {
  if (!database) return;
  await database.close();
  database = null;
}
