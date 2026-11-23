/* Teste funcional da camada de dados MySQL.
 *
 * Não é necessário ter um servidor MySQL nesta máquina: o módulo mysql2 é
 * substituído por um adaptador que traduz o DDL MySQL para SQLite em memória
 * (node:sqlite do Electron). Assim testamos CRUD, FKs, transações e regras de
 * negócio exatamente como o app faz, sem credenciais reais.
 *
 * Uso: node scripts/run-smoke.cjs  (ou npm test)
 */
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const handlers = {};
const externalLinks = [];
let rawDb;

function assert(condition, message) {
  if (!condition) throw new Error('FALHOU: ' + message);
  console.log('  ok - ' + message);
}

const electronStub = {
  app: {
    isPackaged: true,
    getAppPath: () => process.cwd(),
    getPath: (name) => (name === 'exe' ? path.join(process.cwd(), 'oficina.exe') : process.cwd()),
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => {},
  },
  ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
  dialog: { showErrorBox: (title, message) => console.error('[dialog]', title, message) },
  Menu: { setApplicationMenu: () => {} },
  BrowserWindow: class {
    static getAllWindows() { return []; }
    constructor() {
      this.webContents = {
        on: () => {},
        setWindowOpenHandler: () => {},
        openDevTools: () => {},
      };
    }
    loadFile() {}
    loadURL() {}
  },
  shell: { openExternal: async (url) => { externalLinks.push(url); } },
  clipboard: { writeText: () => {} },
};

/** Traduz o schema MySQL para SQLite apenas dentro do teste. */
function toSqlite(sql) {
  return sql
    .replace(/ENGINE=InnoDB[^;]*/gi, '')
    .replace(/INT AUTO_INCREMENT PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/TINYINT\(\d+\)/gi, 'INTEGER')
    .replace(/DECIMAL\(\s*\d+\s*,\s*\d+\s*\)/gi, 'NUMERIC')
    .replace(/VARCHAR\(\d+\)/gi, 'TEXT')
    .replace(/\bDATETIME\b/gi, 'TEXT')
    .replace(/\bDATE\b/gi, 'TEXT');
}

const mysqlStub = {
  createPool() {
    const raw = new DatabaseSync(':memory:');
    raw.exec('PRAGMA foreign_keys = ON');
    rawDb = raw;

    function execute(sql, params = []) {
      const query = toSqlite(sql);
      if (!params.length && /^\s*(CREATE|DROP|ALTER|PRAGMA)\b/i.test(query)) {
        raw.exec(query);
        return [[], []];
      }
      const statement = raw.prepare(query);
      if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(query)) {
        return [statement.all(...params), []];
      }
      const info = statement.run(...params);
      return [{
        affectedRows: Number(info.changes),
        insertId: Number(info.lastInsertRowid),
      }, []];
    }

    const pool = {
      query: async (sql) => execute(sql, []),
      execute: async (sql, params) => execute(sql, params ?? []),
      getConnection: async () => ({
        query: pool.query,
        execute: pool.execute,
        beginTransaction: async () => { raw.exec('BEGIN'); },
        commit: async () => { raw.exec('COMMIT'); },
        rollback: async () => { raw.exec('ROLLBACK'); },
        release: () => {},
      }),
      end: async () => { raw.close(); },
    };
    return pool;
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  if (request === 'mysql2/promise') return mysqlStub;
  return originalLoad.apply(this, arguments);
};

process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '3306';
process.env.DB_USER = process.env.DB_USER || 'oficina';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'senha';
process.env.DB_NAME = process.env.DB_NAME || 'oficina';

const call = async (channel, ...args) => {
  const fn = handlers[channel];
  if (!fn) throw new Error(`Handler IPC não registrado: ${channel}`);
  const result = await fn(null, ...args);
  if (!result.ok) throw new Error(`${channel}: ${result.error}`);
  return result.data;
};

const rawCall = (channel, ...args) => handlers[channel](null, ...args);

(async () => {
  console.log('\n[1] Configuração .env e inicialização');
  assert(fs.existsSync(path.join(__dirname, '..', '.env.example')), 'arquivo .env.example existe');
  assert(/\.env\b/.test(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8')), '.env está no .gitignore');
  require('../out/main/index.js');
  for (let i = 0; i < 100 && !handlers['db:list']; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert(Boolean(handlers['db:list']), 'banco conectou e handlers IPC foram registrados');
  assert(rawDb !== undefined, 'pool MySQL foi criado');

  console.log('\n[2] Schema criado (8 tabelas)');
  const tables = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  assert(tables.length === 8, `8 tabelas criadas (${tables.map((t) => t.name).join(', ')})`);

  console.log('\n[3] CRUD das 8 entidades');
  const cliente = await call('db:create', 'clientes', {
    nome: 'Cliente Teste', telefone: '11999998888', cpf_cnpj: '11122233344', cidade: 'São Paulo',
  });
  assert(cliente.id > 0, 'create clientes');
  assert((await call('db:get', 'clientes', cliente.id)).nome === 'Cliente Teste', 'get clientes');
  assert((await call('db:update', 'clientes', cliente.id, { nome: 'Cliente Teste Editado' })).nome === 'Cliente Teste Editado', 'update clientes');
  assert((await call('db:list', 'clientes', 'Editado')).length === 1, 'busca textual em clientes');
  assert((await call('db:options', 'clientes', 'nome')).some((o) => o.id === cliente.id), 'options clientes');

  const veiculo = await call('db:create', 'veiculos', {
    cliente_id: cliente.id, placa: 'TST1A23', marca: 'Ford', modelo: 'Ka', ano_modelo: 2022,
  });
  assert(veiculo.cliente_nome === 'Cliente Teste Editado', 'FK veiculos -> clientes resolvida');
  assert((await call('db:update', 'veiculos', veiculo.id, { cor: 'Prata' })).cor === 'Prata', 'update veiculos');

  const mecanico = await call('db:create', 'mecanicos', { nome: 'Mecânico Teste', ativo: 1 });
  assert((await call('db:list', 'mecanicos', 'Mecânico')).length === 1, 'create/list mecanicos');
  assert((await call('db:update', 'mecanicos', mecanico.id, { especialidade: 'Motor' })).especialidade === 'Motor', 'update mecanicos');

  const fornecedor = await call('db:create', 'fornecedores', { razao_social: 'Fornecedor Teste', pais: 'Brasil' });
  assert((await call('db:get', 'fornecedores', fornecedor.id)).razao_social === 'Fornecedor Teste', 'create/get fornecedores');
  assert((await call('db:update', 'fornecedores', fornecedor.id, { contato: 'João' })).contato === 'João', 'update fornecedores');

  const peca = await call('db:create', 'pecas', {
    codigo: 'PEC-TESTE', descricao: 'Peça Teste', fornecedor_id: fornecedor.id,
    preco_custo: 30, preco_venda: 50, quantidade: 10, estoque_minimo: 2, moeda: 'BRL',
  });
  assert(peca.fornecedor_nome === 'Fornecedor Teste', 'FK pecas -> fornecedores resolvida');
  assert((await call('db:update', 'pecas', peca.id, { descricao: 'Peça Teste Editada', preco_venda: 55 })).preco_venda === 55, 'update pecas');

  const os = await call('db:create', 'ordens_servico', {
    numero: 'OS-TESTE', veiculo_id: veiculo.id, mecanico_id: mecanico.id,
    data_entrada: '2026-11-23', status: 'ABERTA', valor_mao_obra: 100, desconto: 0,
  });
  assert(os.veiculo_info && os.cliente_nome === 'Cliente Teste Editado', 'FK ordens_servico -> veiculos/clientes resolvida');
  assert((await call('db:update', 'ordens_servico', os.id, { descricao_servico: 'Troca de óleo' })).descricao_servico === 'Troca de óleo', 'update ordens_servico');

  const itemId = await call('os:addItem', os.id, { peca_id: peca.id, quantidade: 2, preco_unitario: 50 });
  const itens = await call('os:items', os.id);
  assert(itens.length === 1 && Number(itens[0].subtotal) === 100, 'create/list itens_ordem com subtotal');
  assert(itemId === itens[0].id, 'os:addItem devolve o id do item');

  await call('db:update', 'itens_ordem', itemId, { peca_id: peca.id, quantidade: 1, preco_unitario: 50 });
  assert((await call('db:get', 'itens_ordem', itemId)).quantidade === 1, 'update itens_ordem');

  const notify = await call('os:notify', os.id);
  const notificacao = await call('db:get', 'notificacoes', notify.notificationId);
  assert(notificacao.ordem_numero === 'OS-TESTE', 'create/get notificacoes vinculada à OS');
  assert((await call('db:update', 'notificacoes', notify.notificationId, { status: 'ENVIADO' })).status === 'ENVIADO', 'update notificacoes');

  console.log('\n[4] Regras de estoque e total da OS');
  assert((await call('db:get', 'pecas', peca.id)).quantidade === 9, 'baixa de estoque ao adicionar item');
  assert((await call('db:get', 'ordens_servico', os.id)).valor_total === 150, 'total recalculado (100 mão de obra + 50 peça)');
  await call('os:removeItem', itemId);
  assert((await call('db:get', 'pecas', peca.id)).quantidade === 10, 'devolução de estoque ao remover item');
  assert((await call('db:get', 'ordens_servico', os.id)).valor_total === 100, 'total recalculado ao remover item');
  const itemGenerico = await call('db:create', 'itens_ordem', { ordem_servico_id: os.id, peca_id: peca.id, quantidade: 2, preco_unitario: 50 });
  assert((await call('db:get', 'pecas', peca.id)).quantidade === 8, 'create via CRUD genérico baixa estoque');
  await call('db:delete', 'itens_ordem', itemGenerico.id);
  assert((await call('db:get', 'pecas', peca.id)).quantidade === 10, 'delete via CRUD genérico devolve estoque');
  await call('db:update', 'ordens_servico', os.id, { valor_mao_obra: 120, desconto: 20 });
  assert((await call('db:get', 'ordens_servico', os.id)).valor_total === 100, 'update da OS recalcula mão de obra - desconto');
  await call('os:setDollar', os.id, 5.43);
  assert(Number((await call('db:get', 'ordens_servico', os.id)).cotacao_dolar) === 5.43, 'cotação do dólar registrada na OS');

  console.log('\n[5] Integridade referencial e aviso');
  const blocked = await rawCall('db:delete', 'clientes', cliente.id);
  assert(blocked.ok === false && /vinculados/.test(blocked.error), 'FK impede excluir cliente com veículo');
  const removedFornecedor = await rawCall('db:delete', 'fornecedores', fornecedor.id);
  assert(removedFornecedor.ok === true, 'fornecedor removido com ON DELETE SET NULL');
  assert((await call('db:get', 'pecas', peca.id)).fornecedor_id === null, 'FK SET NULL aplicada em pecas.fornecedor_id');
  assert(notify.link.startsWith('https://wa.me/55'), 'aviso gera link wa.me com DDI 55');
  assert(externalLinks.length === 1 && externalLinks[0] === notify.link, 'link externo aberto pelo processo principal');

  console.log('\n[6] Dashboard e busca com aliases');
  const dashboard = await call('db:dashboard');
  assert(dashboard.clientes === 1 && dashboard.osAbertas === 1, 'dashboard reflete os dados');
  assert(dashboard.estoqueBaixo === 0, 'dashboard calcula estoque baixo');
  assert((await call('db:list', 'ordens_servico', 'Ka')).length === 1, 'busca usa alias de FK sem erro de SQL');

  console.log('\n[7] APIs sem chave (rede — opcional)');
  try {
    const dollar = await call('api:dollar');
    assert(dollar.bid > 0 && dollar.ask > 0, `cotação do dólar (${dollar.source})`);
  } catch (error) { console.log('  aviso - cotação indisponível: ' + error.message); }
  try {
    const fipe = await call('api:fipe', 'honda', 'civic');
    assert(fipe.length > 0, `FIPE retornou ${fipe.length} veículo(s)`);
  } catch (error) { console.log('  aviso - FIPE indisponível: ' + error.message); }
  const plate = await call('api:plate', 'TST1A23');
  assert(Boolean(plate.marca && plate.modelo), 'consulta de placa retornou dados');

  console.log('\n[8] Exclusões');
  await call('db:delete', 'notificacoes', notify.notificationId);
  await call('db:delete', 'ordens_servico', os.id);
  await call('db:delete', 'veiculos', veiculo.id);
  await call('db:delete', 'clientes', cliente.id);
  await call('db:delete', 'pecas', peca.id);
  await call('db:delete', 'mecanicos', mecanico.id);
  assert(true, 'todos os registros de teste foram excluídos');

  console.log('\nTODOS OS TESTES PASSARAM');
  process.exit(0);
})().catch((error) => {
  console.error('\n' + error.stack);
  process.exit(1);
});
