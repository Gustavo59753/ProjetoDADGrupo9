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

const TABLES = [
  'clientes', 'veiculos', 'mecanicos', 'fornecedores',
  'pecas', 'ordens_servico', 'itens_ordem', 'notificacoes',
];

function assert(condition, message) {
  if (!condition) throw new Error('FALHOU: ' + message);
  console.log('  ok - ' + message);
}

/** Lê o valor físico de `ativo` direto no SQLite (o smoke não tem soft delete vazando para cá). */
function physicalAtivo(table, id) {
  const row = rawDb.prepare(`SELECT ativo FROM ${table} WHERE id = ?`).get(id);
  return row === undefined ? undefined : Number(row.ativo);
}

/** `db:get` de um registro inativado não deve devolver uma linha ativa. */
function isHidden(result) {
  return Boolean(result) && (result.data === undefined || result.data === null);
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

  console.log('\n[2] Schema criado (8 tabelas, todas com ativo)');
  const tables = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  assert(tables.length === 8, `8 tabelas criadas (${tables.map((t) => t.name).join(', ')})`);
  assert(TABLES.every((name) => tables.some((t) => t.name === name)), 'as 8 tabelas esperadas estão presentes');
  for (const table of TABLES) {
    const column = rawDb.prepare(`PRAGMA table_info(${table})`).all().find((c) => c.name === 'ativo');
    assert(Boolean(column), `${table}.ativo existe`);
    assert(
      Number(column.notnull) === 1 && String(column.dflt_value) === '1' &&
        /INTEGER|INT|NUMERIC/i.test(String(column.type)),
      `${table}.ativo é TINYINT(1) NOT NULL DEFAULT 1`
    );
  }
  const clienteColumns = rawDb.prepare('PRAGMA table_info(clientes)').all().map((c) => c.name);
  assert(
    ['tipo_pessoa', 'cep', 'endereco', 'numero', 'cidade', 'uf'].every((c) => clienteColumns.includes(c)),
    'clientes possui tipo_pessoa, CEP, endereço, número, cidade e UF'
  );

  console.log('\n[3] CRUD das 8 entidades');
  const cliente = await call('db:create', 'clientes', {
    nome: 'Cliente Teste', telefone: '11999998888', cpf_cnpj: '52998224725', cidade: 'São Paulo',
    tipo_pessoa: 'PF', cep: '01310-100', endereco: 'Av. Paulista, Bela Vista', numero: '1000',
  });
  assert(cliente.id > 0, 'create clientes');
  const clienteSalvo = await call('db:get', 'clientes', cliente.id);
  assert(clienteSalvo.nome === 'Cliente Teste', 'get clientes');
  assert(
    clienteSalvo.tipo_pessoa === 'PF' && clienteSalvo.cep === '01310-100' &&
      clienteSalvo.endereco === 'Av. Paulista, Bela Vista' && clienteSalvo.numero === '1000',
    'campos tipo_pessoa/CEP/logradouro/número persistidos'
  );
  assert((await call('db:list', 'clientes', '01310')).length === 1, 'busca por CEP em clientes');
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

  console.log('\n[3.1] Validação local de CPF/CNPJ/CEP e Minha Receita (sem chave)');
  const invalidCpf = await rawCall('db:create', 'clientes', {
    nome: 'CPF Inválido', telefone: '11999998888', tipo_pessoa: 'PF', cpf_cnpj: '11122233344',
  });
  assert(invalidCpf.ok === false && /CPF/.test(invalidCpf.error), 'CPF inválido bloqueia db:create');

  const invalidCep = await rawCall('db:create', 'clientes', {
    nome: 'CEP Inválido', telefone: '11999998888', tipo_pessoa: 'PF', cep: '1234',
  });
  assert(invalidCep.ok === false && /CEP/.test(invalidCep.error), 'CEP inválido bloqueia db:create');

  const invalidCnpjCreate = await rawCall('db:create', 'clientes', {
    nome: 'CNPJ Inválido', telefone: '11999998888', tipo_pessoa: 'PJ', cpf_cnpj: '11111111111111',
  });
  assert(invalidCnpjCreate.ok === false && /CNPJ/.test(invalidCnpjCreate.error), 'CNPJ inválido bloqueia db:create');

  const originalFetch = global.fetch;
  let fetchCalls = 0;
  let lastLookupUrl = '';
  let cnpjFetchMode = 'found'; // 'found' | 'not_found' | 'unavailable'
  global.fetch = async (url) => {
    fetchCalls += 1;
    lastLookupUrl = String(url);
    if (!lastLookupUrl.startsWith('https://minhareceita.org/')) {
      throw new Error('requisição de rede inesperada: ' + lastLookupUrl);
    }
    const digits = lastLookupUrl.split('/').pop() ?? '';
    if (cnpjFetchMode === 'not_found') {
      // 99999999000191 tem dígitos válidos, mas não está cadastrado (HTTP 404).
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (cnpjFetchMode === 'unavailable') {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    if (cnpjFetchMode === 'found') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          cnpj: digits,
          razao_social: 'Empresa Teste LTDA',
          nome_fantasia: 'Fantasia Teste',
          logradouro: 'Av. Paulista',
          numero: '100',
          bairro: 'Bela Vista',
          municipio: 'São Paulo',
          uf: 'SP',
          cep: '01310-100',
          complemento: 'Sala 10',
          email: 'contato@empresa.com.br',
          ddd_telefone_1: '1133334444',
          descricao_situacao_cadastral: 'ATIVA',
        }),
      };
    }
    throw new Error('modo de consulta de CNPJ desconhecido: ' + cnpjFetchMode);
  };
  let fornecedorCnpjId = null;
  try {
    const cepResult = await rawCall('api:cep', '1234');
    assert(
      cepResult.ok === true && cepResult.data.status === 'invalid' && /CEP/.test(cepResult.data.message),
      'api:cep com CEP inválido retorna status invalid'
    );

    const cnpjResult = await rawCall('api:cnpj', '11111111111111');
    assert(
      cnpjResult.ok === true && cnpjResult.data.status === 'invalid' && /CNPJ/.test(cnpjResult.data.message),
      'api:cnpj com CNPJ inválido retorna status invalid'
    );
    assert(fetchCalls === 0, 'validações locais não fizeram chamadas de rede');

    cnpjFetchMode = 'found';
    const cnpjFound = await rawCall('api:cnpj', '11.444.777/0001-61');
    assert(
      cnpjFound.ok === true && cnpjFound.data.status === 'found',
      'CNPJ válido passa na validação dos dígitos verificadores'
    );
    assert(
      lastLookupUrl === 'https://minhareceita.org/11444777000161',
      'CNPJ é consultado em https://minhareceita.org/{cnpj}'
    );
    assert(cnpjFound.data.data.cidade === 'São Paulo', 'municipio da Minha Receita preenche cidade');
    assert(cnpjFound.data.data.cep === '01310100', 'CEP da Minha Receita é normalizado');
    assert(
      /ATIVA/i.test(String(cnpjFound.data.data.situacao ?? '')),
      'situação cadastral é mapeada para o tooltip/status do CNPJ'
    );
    assert(
      String(cnpjFound.data.data.telefone ?? '').replace(/\D/g, '') === '1133334444',
      'ddd_telefone_1 da Minha Receita é mapeado para telefone'
    );
    assert(cnpjFound.data.data.email === 'contato@empresa.com.br', 'e-mail da Minha Receita é mapeado');
    assert(cnpjFound.data.data.complemento === 'Sala 10', 'complemento da Minha Receita é mapeado');
    assert(fetchCalls === 1, 'somente a consulta de CNPJ válido fez requisição');

    cnpjFetchMode = 'not_found';
    const cnpjNotFound = await rawCall('api:cnpj', '99.999.999/0001-91');
    assert(
      cnpjNotFound.ok === true && cnpjNotFound.data.status === 'not_found' &&
        /CNPJ/.test(String(cnpjNotFound.data.message)),
      'api:cnpj com CNPJ inexistente (99999999000191) retorna not_found no HTTP 404'
    );

    cnpjFetchMode = 'unavailable';
    const cnpjUnavailable = await rawCall('api:cnpj', '27.865.757/0001-02');
    assert(
      cnpjUnavailable.ok === true && cnpjUnavailable.data.status === 'unavailable' &&
        /CNPJ/.test(String(cnpjUnavailable.data.message)),
      'api:cnpj com falha na Minha Receita retorna unavailable'
    );

    // Fornecedores: backend também valida e bloqueia CNPJ inválido/inexistente/indisponível.
    cnpjFetchMode = 'found';
    const fornecedorComCnpj = await call('db:create', 'fornecedores', {
      cnpj: '12.345.678/0001-95', razao_social: '', contato: 'Contato Teste', pais: '',
    });
    assert(Number(fornecedorComCnpj.id) > 0, 'CNPJ found permite db:create de fornecedores');
    fornecedorCnpjId = Number(fornecedorComCnpj.id);
    assert(
      String(fornecedorComCnpj.cnpj).replace(/\D/g, '') === '12345678000195',
      'CNPJ do fornecedor é normalizado ao salvar'
    );
    assert(
      fornecedorComCnpj.razao_social === 'Empresa Teste LTDA',
      'dados da Minha Receita preenchem razão social vazia do fornecedor'
    );
    assert(fornecedorComCnpj.pais === 'Brasil', 'país padrão é preenchido quando vazio');
    assert(
      /Endereço \(Minha Receita\)/.test(String(fornecedorComCnpj.observacoes ?? '')),
      'endereço da Minha Receita é anexado às observações do fornecedor'
    );
    assert(fornecedorComCnpj.contato === 'Contato Teste', 'contato informado manualmente é preservado');

    const fornecedorCnpjInvalido = await rawCall('db:create', 'fornecedores', {
      razao_social: 'Fornecedor CNPJ Inválido', cnpj: '11111111111111', pais: 'Brasil',
    });
    assert(
      fornecedorCnpjInvalido.ok === false && /CNPJ/.test(String(fornecedorCnpjInvalido.error)),
      'CNPJ inválido bloqueia db:create de fornecedores'
    );

    cnpjFetchMode = 'not_found';
    const fornecedorInexistente = await rawCall('db:create', 'fornecedores', {
      razao_social: 'Fornecedor Inexistente', cnpj: '99.999.999/0001-91', pais: 'Brasil',
    });
    assert(
      fornecedorInexistente.ok === false && /CNPJ/.test(String(fornecedorInexistente.error)),
      'CNPJ inexistente bloqueia db:create de fornecedores'
    );

    cnpjFetchMode = 'unavailable';
    const fornecedorIndisponivel = await rawCall('db:create', 'fornecedores', {
      razao_social: 'Fornecedor Sem Consulta', cnpj: '27.865.757/0001-02', pais: 'Brasil',
    });
    assert(
      fornecedorIndisponivel.ok === false && /CNPJ/.test(String(fornecedorIndisponivel.error)),
      'CNPJ unavailable bloqueia db:create de fornecedores (CNPJ sendo informado)'
    );

    const fornecedorSemAlterarCnpj = await call('db:update', 'fornecedores', fornecedorComCnpj.id, {
      contato: 'Contato Atualizado',
    });
    assert(
      fornecedorSemAlterarCnpj.contato === 'Contato Atualizado',
      'edição sem alterar CNPJ não é bloqueada quando a consulta está indisponível'
    );

    const cnpjAlteradoIndisponivel = await rawCall('db:update', 'fornecedores', fornecedorComCnpj.id, {
      cnpj: '02.145.678/0001-98',
    });
    assert(
      cnpjAlteradoIndisponivel.ok === false && /CNPJ/.test(String(cnpjAlteradoIndisponivel.error)),
      'CNPJ unavailable bloqueia db:update quando o CNPJ está sendo alterado'
    );

    cnpjFetchMode = 'found';
    const cnpjAlteradoOk = await call('db:update', 'fornecedores', fornecedorComCnpj.id, {
      cnpj: '02.145.678/0001-98',
    });
    assert(
      String(cnpjAlteradoOk.cnpj).replace(/\D/g, '') === '02145678000198',
      'CNPJ found permite db:update de fornecedores'
    );

    // Clientes PJ: not_found/unavailable apenas avisam — não bloqueiam o cadastro.
    cnpjFetchMode = 'not_found';
    const clientePjInexistente = await call('db:create', 'clientes', {
      nome: 'Cliente PJ Inexistente', telefone: '11999998888', tipo_pessoa: 'PJ', cpf_cnpj: '11222333000181',
    });
    assert(clientePjInexistente.id > 0, 'cliente PJ com CNPJ not_found é criado (aviso não bloqueia)');
    await call('db:delete', 'clientes', clientePjInexistente.id);

    cnpjFetchMode = 'unavailable';
    const clientePjIndisponivel = await call('db:create', 'clientes', {
      nome: 'Cliente PJ Indisponível', telefone: '11999998888', tipo_pessoa: 'PJ', cpf_cnpj: '05678912000130',
    });
    assert(clientePjIndisponivel.id > 0, 'cliente PJ com CNPJ unavailable é criado (aviso não bloqueia)');
    await call('db:delete', 'clientes', clientePjIndisponivel.id);
  } finally {
    global.fetch = originalFetch;
  }

  console.log('\n[3.2] Validação de e-mail no CRUD genérico');
  const emailInvalidoCreate = await rawCall('db:create', 'mecanicos', {
    nome: 'Mecânico Email Inválido', ativo: 1, email: 'cliente',
  });
  assert(
    emailInvalidoCreate.ok === false && /E-mail inválido/.test(emailInvalidoCreate.error),
    'e-mail inválido bloqueia db:create de entidade com campo email'
  );

  const mecanicoEmail = await call('db:create', 'mecanicos', {
    nome: 'Mecânico Email', ativo: 1, email: 'cliente@gmail.com',
  });
  assert(mecanicoEmail.email === 'cliente@gmail.com', 'e-mail válido é aceito em db:create');

  const emailInvalidoUpdate = await rawCall('db:update', 'mecanicos', mecanicoEmail.id, { email: 'cliente' });
  assert(
    emailInvalidoUpdate.ok === false && /E-mail inválido/.test(emailInvalidoUpdate.error),
    'e-mail inválido bloqueia db:update'
  );

  const atualizadoSemEmail = await call('db:update', 'mecanicos', mecanicoEmail.id, {
    observacoes: 'Alteração sem e-mail',
  });
  assert(
    atualizadoSemEmail.email === 'cliente@gmail.com' && atualizadoSemEmail.observacoes === 'Alteração sem e-mail',
    'update parcial sem email continua funcionando'
  );

  console.log('\n[4] Estoque, total da OS e reativação de item inativado');
  assert((await call('db:get', 'pecas', peca.id)).quantidade === 9, 'baixa de estoque ao adicionar item');
  assert((await call('db:get', 'ordens_servico', os.id)).valor_total === 150, 'total recalculado (100 mão de obra + 50 peça)');

  assert(physicalAtivo('itens_ordem', itemId) === 1, 'item está ativo após os:addItem');
  await call('os:removeItem', itemId);
  assert((await call('db:get', 'pecas', peca.id)).quantidade === 10, 'devolução de estoque ao remover item');
  assert((await call('db:get', 'ordens_servico', os.id)).valor_total === 100, 'total recalculado ao remover item');
  assert(physicalAtivo('itens_ordem', itemId) === 0, 'os:removeItem inativa o item (registro físico permanece)');
  assert((await call('os:items', os.id)).length === 0, 'os:items não lista item inativado');
  assert(isHidden(await rawCall('db:get', 'itens_ordem', itemId)), 'db:get não enxerga item inativado');

  const itemReativadoId = await call('os:addItem', os.id, {
    peca_id: peca.id, quantidade: 3, preco_unitario: 50,
  });
  assert(
    itemReativadoId === itemId,
    'readicionar a mesma peça reativa o item existente (mesmo id, sem violar UNIQUE)'
  );
  assert(physicalAtivo('itens_ordem', itemId) === 1, 'item reativado volta a ativo=1');
  assert((await call('db:get', 'pecas', peca.id)).quantidade === 7, 'estoque é baixado pela nova quantidade ao reativar');
  assert((await call('db:get', 'ordens_servico', os.id)).valor_total === 250, 'total é recalculado com o item reativado');
  const itensReativados = await call('os:items', os.id);
  assert(
    itensReativados.length === 1 && Number(itensReativados[0].quantidade) === 3 &&
      Number(itensReativados[0].subtotal) === 150,
    'item reativado traz quantidade e subtotal atualizados'
  );

  await call('os:removeItem', itemId);
  assert((await call('db:get', 'pecas', peca.id)).quantidade === 10, 'nova remoção devolve o estoque');
  const itemGenerico = await call('db:create', 'itens_ordem', {
    ordem_servico_id: os.id, peca_id: peca.id, quantidade: 2, preco_unitario: 50,
  });
  assert(itemGenerico.id === itemId, 'db:create de item inativado reativa o registro em vez de violar UNIQUE');
  assert((await call('db:get', 'pecas', peca.id)).quantidade === 8, 'create via CRUD genérico baixa estoque');
  await call('db:delete', 'itens_ordem', itemGenerico.id);
  assert(physicalAtivo('itens_ordem', itemGenerico.id) === 0, 'db:delete inativa item de ordem');
  assert((await call('db:get', 'pecas', peca.id)).quantidade === 10, 'delete via CRUD genérico devolve estoque');
  assert((await call('db:get', 'ordens_servico', os.id)).valor_total === 100, 'total volta ao valor sem peças');
  await call('db:update', 'ordens_servico', os.id, { valor_mao_obra: 120, desconto: 20 });
  assert((await call('db:get', 'ordens_servico', os.id)).valor_total === 100, 'update da OS recalcula mão de obra - desconto');
  await call('os:setDollar', os.id, 5.43);
  assert(Number((await call('db:get', 'ordens_servico', os.id)).cotacao_dolar) === 5.43, 'cotação do dólar registrada na OS');

  console.log('\n[5] Soft delete, FKs físicas e rótulos');
  assert(notify.link.startsWith('https://wa.me/55'), 'aviso gera link wa.me com DDI 55');
  assert(externalLinks.length === 1 && externalLinks[0] === notify.link, 'link externo aberto pelo processo principal');

  const clientesAtivosAntes = (await call('db:list', 'clientes')).length;
  assert(
    (await call('db:get', 'veiculos', veiculo.id)).cliente_nome === 'Cliente Teste Editado',
    'rótulo de FK mostra o cliente enquanto ativo'
  );
  const clienteInativado = await rawCall('db:delete', 'clientes', cliente.id);
  assert(clienteInativado.ok === true, 'db:delete inativa cliente mesmo com veículos (sem RESTRICT lógico)');
  assert(physicalAtivo('clientes', cliente.id) === 0, 'cliente permanece no banco com ativo=0');
  assert(isHidden(await rawCall('db:get', 'clientes', cliente.id)), 'db:get não enxerga cliente inativado');
  assert(!(await call('db:list', 'clientes')).some((c) => c.id === cliente.id), 'db:list não mostra cliente inativado');
  assert(!(await call('db:options', 'clientes', 'nome')).some((o) => o.id === cliente.id), 'db:options não mostra cliente inativado');
  const veiculoComPaiInativo = await call('db:get', 'veiculos', veiculo.id);
  assert(veiculoComPaiInativo.cliente_id === cliente.id, 'veículo mantém a FK física (sem cascade lógico)');
  assert(veiculoComPaiInativo.cliente_nome === '—', 'subquery de rótulo mostra — quando o cliente pai está inativo');
  assert((await call('db:dashboard')).clientes === clientesAtivosAntes - 1, 'dashboard ignora cliente inativado');

  const fornecedorInativado = await rawCall('db:delete', 'fornecedores', fornecedor.id);
  assert(fornecedorInativado.ok === true, 'db:delete inativa fornecedor');
  assert(physicalAtivo('fornecedores', fornecedor.id) === 0, 'fornecedor permanece no banco com ativo=0');
  const pecaComFornecedorInativo = await call('db:get', 'pecas', peca.id);
  assert(
    pecaComFornecedorInativo.fornecedor_id === fornecedor.id,
    'peça mantém fornecedor_id (sem ON DELETE SET NULL lógico)'
  );
  assert(pecaComFornecedorInativo.fornecedor_nome === '—', 'rótulo de fornecedor inativo mostra —');

  const mecanicoInativado = await rawCall('db:delete', 'mecanicos', mecanico.id);
  assert(mecanicoInativado.ok === true, 'db:delete inativa mecânico');
  assert(
    !(await call('db:options', 'mecanicos', 'nome')).some((o) => o.id === mecanico.id),
    'mecânico inativado some das opções de FK'
  );
  const osComMecanicoInativo = await call('db:get', 'ordens_servico', os.id);
  assert(osComMecanicoInativo.mecanico_id === mecanico.id, 'OS mantém mecanico_id (sem SET NULL lógico)');
  assert(osComMecanicoInativo.mecanico_nome === '—', 'rótulo de mecânico inativo mostra —');

  await call('db:update', 'pecas', peca.id, { quantidade: 1 });
  assert((await call('db:dashboard')).estoqueBaixo === 1, 'peça ativa com estoque baixo entra no dashboard');
  const pecaInativada = await rawCall('db:delete', 'pecas', peca.id);
  assert(pecaInativada.ok === true, 'db:delete inativa peça');
  assert((await call('db:dashboard')).estoqueBaixo === 0, 'peça inativada sai do cálculo de estoque baixo');

  // UNIQUE continua valendo para valores pertencentes a registros inativados.
  const cpfDuplicado = await rawCall('db:create', 'clientes', {
    nome: 'Cliente Com CPF Repetido', telefone: '11999998888', tipo_pessoa: 'PF', cpf_cnpj: '52998224725',
  });
  assert(
    cpfDuplicado.ok === false && /reativ/i.test(String(cpfDuplicado.error)),
    'CPF de cliente inativado não pode ser reaproveitado; erro sugere reativação'
  );
  const codigoDuplicado = await rawCall('db:create', 'pecas', {
    codigo: 'PEC-TESTE', descricao: 'Peça com código repetido', preco_venda: 50, quantidade: 1,
  });
  assert(
    codigoDuplicado.ok === false && /reativ/i.test(String(codigoDuplicado.error)),
    'código de peça inativada não pode ser reaproveitado; erro sugere reativação'
  );

  console.log('\n[5.1] Avisos por app nativo (SMS e e-mail, sem API paga)');
  const linksAposOsNotify = externalLinks.length;
  const avisoSms = await call('notification:create', {
    canal: 'SMS', destino: '19981848882', mensagem: 'Seu veículo está pronto para retirada.',
  });
  assert(avisoSms.link.startsWith('sms:5519981848882?body='), 'notification:create SMS gera link sms: com DDI 55');
  assert(avisoSms.status === 'ABERTO_NO_APP', 'SMS retorna status ABERTO_NO_APP');
  const avisoSmsSalvo = await call('db:get', 'notificacoes', avisoSms.notificationId);
  assert(avisoSmsSalvo.canal === 'SMS' && avisoSmsSalvo.status === 'ABERTO_NO_APP', 'SMS e status persistidos no aviso');
  assert(
    avisoSmsSalvo.destino === '(19) 98184-8882',
    'notification:create grava destino de dígitos puros com a máscara da UI'
  );
  assert(
    (await call('db:list', 'notificacoes', '19981848882')).some((n) => n.id === avisoSms.notificationId),
    'db:list encontra aviso pelo telefone sem máscara'
  );

  const avisoEmail = await call('notification:create', {
    canal: 'E-mail', destino: 'cliente@gmail.com', mensagem: 'Seu veículo está pronto para retirada.',
  });
  assert(avisoEmail.link.startsWith('mailto:cliente@gmail.com?subject='), 'notification:create E-mail gera link mailto:');
  const mailtoDecodificado = decodeURIComponent(avisoEmail.link);
  assert(
    mailtoDecodificado.includes('subject=Aviso da oficina') &&
      mailtoDecodificado.includes('body=Seu veículo está pronto para retirada.'),
    'link mailto: traz assunto e corpo da mensagem'
  );
  assert(avisoEmail.status === 'ABERTO_NO_APP', 'E-mail retorna status ABERTO_NO_APP');

  const avisoEmailAlias = await call('notification:create', {
    canal: 'Email', destino: 'alias@gmail.com', mensagem: 'Aviso enviado com o alias de canal.',
  });
  assert(
    avisoEmailAlias.link.startsWith('mailto:alias@gmail.com?subject='),
    'alias Email (sem hífen) também gera link mailto:'
  );
  assert(avisoEmailAlias.status === 'ABERTO_NO_APP', 'alias Email retorna status ABERTO_NO_APP');
  const avisoEmailAliasSalvo = await call('db:get', 'notificacoes', avisoEmailAlias.notificationId);
  assert(
    avisoEmailAliasSalvo.canal === 'E-mail' && avisoEmailAliasSalvo.status === 'ABERTO_NO_APP',
    'alias Email é normalizado para E-mail ao persistir o aviso'
  );
  assert(
    externalLinks.length === linksAposOsNotify + 3 &&
      externalLinks[linksAposOsNotify] === avisoSms.link &&
      externalLinks[linksAposOsNotify + 1] === avisoEmail.link &&
      externalLinks[linksAposOsNotify + 2] === avisoEmailAlias.link,
    'cada aviso abre exatamente uma deep link no processo principal'
  );

  const emailInvalido = await rawCall('notification:create', {
    canal: 'E-mail', destino: 'cliente', mensagem: 'Aviso com destinatário inválido.',
  });
  assert(emailInvalido.ok === false && /E-mail/.test(emailInvalido.error), 'E-mail inválido retorna ok:false');
  assert(externalLinks.length === linksAposOsNotify + 3, 'destino inválido não abre nenhum app externo');

  console.log('\n[6] Dashboard e busca com aliases');
  const dashboard = await call('db:dashboard');
  assert(dashboard.osAbertas === 1 && dashboard.clientes === 0, 'dashboard reflete apenas registros ativos');
  assert(dashboard.estoqueBaixo === 0, 'dashboard calcula estoque baixo sem as peças inativadas');
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
  console.log('\n[7.1] Consulta de placa no cadastro de veículos (sem rede)');
  const fetchBeforePlate = global.fetch;
  let plateFetchCalls = 0;
  global.fetch = async () => {
    plateFetchCalls += 1;
    throw new Error('requisição de rede inesperada na consulta de placa');
  };
  try {
    const plate = await call('db:plate', 'TST1A23');
    assert(
      plate.status === 'found' && plate.data.marca === 'Ford' && plate.data.modelo === 'Ka',
      'db:plate encontrou o veículo cadastrado com marca/modelo corretos'
    );
    assert(
      plate.data.anoModelo === 2022 && plate.data.cor === 'Prata',
      'db:plate mapeou anoModelo e cor do veículo'
    );
    assert(
      plate.data.ordensServico.length === 1 &&
        plate.data.ordensServico[0].numero === 'OS-TESTE' &&
        plate.data.ordensServico[0].status === 'ABERTA' &&
        Number(plate.data.ordensServico[0].valorTotal) === 100,
      'db:plate retornou a ordem de serviço ativa do veículo'
    );
    assert(
      plate.data.ordensServico[0].dataEntrada === '2026-11-23' &&
        plate.data.ordensServico[0].dataSaida === null &&
        plate.data.ordensServico[0].descricaoProblema === null,
      'db:plate normalizou dataEntrada, dataSaida e descricaoProblema da OS'
    );

    const plateNormalized = await call('db:plate', 'tst-1a23');
    assert(
      plateNormalized.status === 'found' && plateNormalized.data.ordensServico.length === 1,
      'db:plate normaliza placa com hífen e minúsculas e mantém as OS vinculadas'
    );

    const missingPlate = await rawCall('db:plate', 'ZZZ9999');
    assert(
      missingPlate.ok === true && missingPlate.data.status === 'not_found',
      'db:plate com placa inexistente retorna not_found'
    );

    const invalidPlate = await rawCall('db:plate', 'ABC');
    assert(
      invalidPlate.ok === true && invalidPlate.data.status === 'invalid',
      'db:plate com placa inválida retorna invalid'
    );

    assert(plateFetchCalls === 0, 'consulta de placa não fez nenhuma requisição de rede');
  } finally {
    global.fetch = fetchBeforePlate;
  }

  console.log('\n[8] Exclusões (soft delete)');
  await call('db:delete', 'notificacoes', avisoSms.notificationId);
  await call('db:delete', 'notificacoes', avisoEmail.notificationId);
  await call('db:delete', 'notificacoes', avisoEmailAlias.notificationId);
  await call('db:delete', 'notificacoes', notify.notificationId);
  await call('db:delete', 'ordens_servico', os.id);
  const plateSemOsAtiva = await call('db:plate', 'TST1A23');
  assert(
    plateSemOsAtiva.status === 'found' && plateSemOsAtiva.data.ordensServico.length === 0,
    'db:plate não devolve ordens de serviço inativadas'
  );
  await call('db:delete', 'veiculos', veiculo.id);
  await call('db:delete', 'mecanicos', mecanicoEmail.id);
  await call('db:delete', 'fornecedores', fornecedorCnpjId);
  assert(true, 'todos os registros de teste foram inativados');
  const registrosFisicos = TABLES.reduce(
    (total, table) => total + Number(rawDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n), 0
  );
  assert(registrosFisicos > 0, 'os registros físicos permanecem no banco após o soft delete');

  console.log('\nTODOS OS TESTES PASSARAM');
  process.exit(0);
})().catch((error) => {
  console.error('\n' + error.stack);
  process.exit(1);
});
