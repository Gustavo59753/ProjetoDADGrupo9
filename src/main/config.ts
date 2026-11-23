import dotenv from 'dotenv';
import { app } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Carrega o .env da raiz do projeto (dev) ou de ao lado do executável (produção). */
function loadEnv(): void {
  const candidates = [process.cwd(), app.getAppPath(), dirname(app.getPath('exe'))];
  for (const dir of candidates) {
    const file = join(dir, '.env');
    if (existsSync(file)) dotenv.config({ path: file });
  }
  // Mantém variáveis já definidas pelo sistema/processo (dotenv não sobrescreve).
  dotenv.config();
}

loadEnv();

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
  ssl: boolean;
  timezone: string;
}

export function readDbConfig(): DbConfig {
  const missing = ['DB_HOST', 'DB_USER', 'DB_NAME'].filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Banco não configurado. Copie ".env.example" para ".env" na raiz do projeto e preencha: ${missing.join(', ')}. ` +
      'O aplicativo será encerrado.'
    );
  }

  const port = Number(process.env.DB_PORT ?? 3306);
  if (!Number.isInteger(port) || port <= 0) throw new Error('DB_PORT deve ser um número válido.');

  return {
    host: process.env.DB_HOST!,
    port,
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME!,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10),
    ssl: String(process.env.DB_SSL ?? 'false').toLowerCase() === 'true',
    timezone: process.env.DB_TIMEZONE ?? 'local',
  };
}
