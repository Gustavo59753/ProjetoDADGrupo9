-- ============================================================
-- Oficina mecânica — modelo relacional MySQL/MariaDB (8 tabelas)
-- Estrutura criada automaticamente na primeira execução.
-- ============================================================

CREATE TABLE IF NOT EXISTS fornecedores (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  razao_social  VARCHAR(180) NOT NULL,
  cnpj          VARCHAR(20) UNIQUE,
  contato       VARCHAR(120),
  telefone      VARCHAR(40),
  email         VARCHAR(160),
  pais          VARCHAR(80) NOT NULL DEFAULT 'Brasil',
  observacoes   TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clientes (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  nome         VARCHAR(180) NOT NULL,
  cpf_cnpj     VARCHAR(20) UNIQUE,
  telefone     VARCHAR(40) NOT NULL,
  email        VARCHAR(160),
  endereco     VARCHAR(240),
  cidade       VARCHAR(120),
  uf           VARCHAR(2),
  observacoes  TEXT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS veiculos (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id      INT NOT NULL,
  placa           VARCHAR(10) NOT NULL UNIQUE,
  marca           VARCHAR(100),
  modelo          VARCHAR(140),
  ano_fabricacao  INT,
  ano_modelo      INT,
  cor             VARCHAR(60),
  combustivel     VARCHAR(40),
  chassi          VARCHAR(60),
  renavam         VARCHAR(30),
  importado       TINYINT(1) NOT NULL DEFAULT 0,
  observacoes     TEXT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_veiculos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
  CONSTRAINT chk_veiculos_importado CHECK (importado IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mecanicos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nome          VARCHAR(180) NOT NULL,
  especialidade VARCHAR(140),
  telefone      VARCHAR(40),
  email         VARCHAR(160),
  ativo         TINYINT(1) NOT NULL DEFAULT 1,
  observacoes   TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_mecanicos_ativo CHECK (ativo IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pecas (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  codigo         VARCHAR(60) NOT NULL UNIQUE,
  descricao      VARCHAR(200) NOT NULL,
  fornecedor_id  INT,
  numero_peca    VARCHAR(80),
  preco_custo    DECIMAL(12,2) NOT NULL DEFAULT 0,
  preco_venda    DECIMAL(12,2) NOT NULL,
  quantidade     INT NOT NULL DEFAULT 0,
  estoque_minimo INT NOT NULL DEFAULT 0,
  importada      TINYINT(1) NOT NULL DEFAULT 0,
  moeda          VARCHAR(3) NOT NULL DEFAULT 'BRL',
  observacoes    TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pecas_fornecedor FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE SET NULL,
  CONSTRAINT chk_pecas_valores CHECK (preco_custo >= 0 AND preco_venda >= 0 AND quantidade >= 0 AND estoque_minimo >= 0),
  CONSTRAINT chk_pecas_importada CHECK (importada IN (0, 1)),
  CONSTRAINT chk_pecas_moeda CHECK (moeda IN ('BRL', 'USD'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ordens_servico (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  numero             VARCHAR(40) NOT NULL UNIQUE,
  veiculo_id         INT NOT NULL,
  mecanico_id        INT,
  data_entrada       DATE NOT NULL,
  data_saida         DATE,
  status             VARCHAR(24) NOT NULL DEFAULT 'ABERTA',
  descricao_problema TEXT,
  descricao_servico  TEXT,
  valor_mao_obra     DECIMAL(12,2) NOT NULL DEFAULT 0,
  desconto           DECIMAL(12,2) NOT NULL DEFAULT 0,
  cotacao_dolar      DECIMAL(12,4),
  valor_total        DECIMAL(12,2) NOT NULL DEFAULT 0,
  observacoes        TEXT,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_os_veiculo FOREIGN KEY (veiculo_id) REFERENCES veiculos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_os_mecanico FOREIGN KEY (mecanico_id) REFERENCES mecanicos(id) ON DELETE SET NULL,
  CONSTRAINT chk_os_status CHECK (status IN ('ABERTA', 'EM_ANDAMENTO', 'AGUARDANDO_PECA', 'PRONTA', 'ENTREGUE', 'CANCELADA')),
  CONSTRAINT chk_os_valores CHECK (valor_mao_obra >= 0 AND desconto >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS itens_ordem (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ordem_servico_id INT NOT NULL,
  peca_id          INT NOT NULL,
  quantidade       INT NOT NULL,
  preco_unitario   DECIMAL(12,2) NOT NULL,
  subtotal         DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_itens_os FOREIGN KEY (ordem_servico_id) REFERENCES ordens_servico(id) ON DELETE CASCADE,
  CONSTRAINT fk_itens_peca FOREIGN KEY (peca_id) REFERENCES pecas(id) ON DELETE RESTRICT,
  CONSTRAINT uq_item_os_peca UNIQUE (ordem_servico_id, peca_id),
  CONSTRAINT chk_itens_valores CHECK (quantidade > 0 AND preco_unitario >= 0 AND subtotal >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notificacoes (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  ordem_servico_id INT,
  cliente_id       INT,
  canal            VARCHAR(12) NOT NULL DEFAULT 'WhatsApp',
  destino          VARCHAR(120) NOT NULL,
  mensagem         TEXT NOT NULL,
  status           VARCHAR(24) NOT NULL DEFAULT 'PENDENTE',
  erro             VARCHAR(255),
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notificacoes_os FOREIGN KEY (ordem_servico_id) REFERENCES ordens_servico(id) ON DELETE CASCADE,
  CONSTRAINT fk_notificacoes_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL,
  CONSTRAINT chk_notificacoes_canal CHECK (canal IN ('WhatsApp', 'SMS', 'E-mail')),
  CONSTRAINT chk_notificacoes_status CHECK (status IN ('PENDENTE', 'ABERTO_NO_WHATSAPP', 'ENVIADO', 'FALHA'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Índices das chaves estrangeiras
CREATE INDEX idx_veiculos_cliente     ON veiculos(cliente_id);
CREATE INDEX idx_pecas_fornecedor     ON pecas(fornecedor_id);
CREATE INDEX idx_os_veiculo           ON ordens_servico(veiculo_id);
CREATE INDEX idx_os_mecanico          ON ordens_servico(mecanico_id);
CREATE INDEX idx_itens_os             ON itens_ordem(ordem_servico_id);
CREATE INDEX idx_itens_peca           ON itens_ordem(peca_id);
CREATE INDEX idx_notificacoes_os      ON notificacoes(ordem_servico_id);
CREATE INDEX idx_notificacoes_cliente ON notificacoes(cliente_id);
