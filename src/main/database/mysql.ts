import { createPool, type Pool, type PoolConnection } from 'mysql2/promise';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DbConfig } from '../config';

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

/**
 * Adapter MySQL/MariaDB com API semelhante à usada pelo repositório
 * (prepare/run/get/all/exec/transaction). Transações usam a mesma conexão
 * via AsyncLocalStorage, garantindo que todas as queries entrem no BEGIN/COMMIT.
 */
export class Db {
  private readonly pool: Pool;
  private readonly context = new AsyncLocalStorage<PoolConnection>();

  private constructor(pool: Pool) {
    this.pool = pool;
  }

  static async connect(config: DbConfig): Promise<Db> {
    const pool = createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: config.connectionLimit,
      charset: 'utf8mb4',
      timezone: config.timezone,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      namedPlaceholders: false,
      decimalNumbers: true,
    });
    await pool.query('SELECT 1');
    return new Db(pool);
  }

  private get runner(): Pool | PoolConnection {
    return this.context.getStore() ?? this.pool;
  }

  async exec(sql: string): Promise<void> {
    const statements = sql
      .split(';')
      .map((part) => part
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim())
      .filter((part) => part.length > 0);
    for (const statement of statements) {
      try {
        await this.runner.query(statement);
      } catch (error: any) {
        // CREATE INDEX é idempotente por erro ignorado (MySQL não tem IF NOT EXISTS)
        if (error?.code === 'ER_DUP_KEYNAME' || error?.errno === 1061) continue;
        throw error;
      }
    }
  }

  prepare(sql: string) {
    const runner = () => this.runner;
    return {
      run: async (...params: unknown[]): Promise<RunResult> => {
        const [result]: any = await runner().execute(sql, params as any[]);
        return {
          changes: Number(result?.affectedRows ?? 0),
          lastInsertRowid: Number(result?.insertId ?? 0),
        };
      },
      get: async (...params: unknown[]): Promise<any> => {
        const [rows]: any = await runner().execute(sql, params as any[]);
        return rows[0];
      },
      all: async (...params: unknown[]): Promise<any[]> => {
        const [rows]: any = await runner().execute(sql, params as any[]);
        return rows as any[];
      },
    };
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Já estamos dentro de uma transação: reaproveita a conexão ativa.
    if (this.context.getStore()) return fn();

    const connection = await this.pool.getConnection();
    return this.context.run(connection, async () => {
      try {
        await connection.beginTransaction();
        const result = await fn();
        await connection.commit();
        return result;
      } catch (error) {
        try { await connection.rollback(); } catch { /* conexão pode ter caído */ }
        throw error;
      } finally {
        connection.release();
      }
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
