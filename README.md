# Oficina Manager — Gestão de Oficina Mecânica

Aplicativo desktop (Electron + TypeScript + Tailwind CSS) para organizar o atendimento de uma oficina mecânica: clientes, veículos, mecânicos, ordens de serviço, peças com estoque, fornecedores e avisos de retirada.

**Requisitos atendidos**

- Banco relacional **MySQL/MariaDB configurado por `.env`**, com **8 tabelas ligadas por chaves estrangeiras reais**.
- **CRUD completo nas 8 entidades** (criar, listar/buscar, editar e excluir), não apenas na tabela principal.
- **Consumo de APIs** sem chave: cotação do dólar, Tabela FIPE e consulta de placa (com fallback demonstrativo identificado).
- Aviso de veículo pronto por mensagem (WhatsApp via link `wa.me`, sem API paga).

---

## 1. Configurando o banco (`.env`)

O aplicativo **não usa mais um banco local automático**. Ele conecta no seu próprio MySQL/MariaDB usando as credenciais do `.env`.

1. Copie o modelo:

   ```bash
   cp .env.example .env
   ```

   (no Windows PowerShell: `Copy-Item .env.example .env`)

2. Edite o `.env` na raiz do projeto:

   ```env
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=oficina
   DB_PASSWORD=senha_do_banco
   DB_NAME=oficina
   ```

3. Crie o banco e o usuário no MySQL/MariaDB (uma vez só):

   ```sql
   CREATE DATABASE oficina CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'oficina'@'localhost' IDENTIFIED BY 'senha_do_banco';
   GRANT ALL PRIVILEGES ON oficina.* TO 'oficina'@'localhost';
   FLUSH PRIVILEGES;
   ```

   Se o app e o banco estiverem em máquinas diferentes, troque `localhost` pelo host correto e use `'oficina'@'%'` (ou o IP do cliente).

### Variáveis disponíveis

| Variável | Obrigatória | Padrão | Descrição |
|----------|-------------|--------|-----------|
| `DB_HOST` | Sim | — | Endereço do servidor MySQL/MariaDB |
| `DB_PORT` | Não | `3306` | Porta TCP |
| `DB_USER` | Sim | — | Usuário do banco |
| `DB_PASSWORD` | Não | vazio | Senha do usuário |
| `DB_NAME` | Sim | — | Nome do banco de dados |
| `DB_CONNECTION_LIMIT` | Não | `10` | Tamanho do pool de conexões |
| `DB_SSL` | Não | `false` | `true` para conexões TLS (`rejectUnauthorized: false`) |
| `DB_TIMEZONE` | Não | `local` | Ex.: `local`, `Z`, `-03:00` |

> **Segurança:** o `.env` está listado no `.gitignore` (assim como `.env.*`, exceto `.env.example`). Nunca comite suas credenciais. Em produção, o app também procura o `.env` ao lado do executável.

### O que acontece ao iniciar

- O app lê o `.env`, conecta e **cria as 8 tabelas se elas não existirem** (`CREATE TABLE IF NOT EXISTS`) — não é necessário rodar migrações manuais.
- **Nenhum dado de exemplo é inserido**: o banco começa vazio, pronto para os seus dados reais.
- Se o `.env` estiver ausente/incompleto ou a conexão falhar, aparece uma mensagem clara e o aplicativo é encerrado — ele não tenta usar um banco fallback.

---

## 2. Como executar

Requisitos: **Node.js 20.19+ ou 22.12+**, npm e um MySQL/MariaDB acessível.

```bash
npm install
npm run dev        # desenvolvimento (abre a janela + DevTools)
```

O `postinstall` do projeto baixa o binário do Electron e cria `node_modules/electron/path.txt` automaticamente. Se aparecer `Error: Electron uninstall` ao iniciar, rode `npm run postinstall` (ou `npm install` novamente) — isso costuma acontecer quando o `node_modules` foi copiado de outra máquina ou instalado com `--ignore-scripts`.

Produção:

```bash
npm run build      # checagem de tipos + build (saída em out/)
npm start          # abre a versão compilada
npm test           # build + teste funcional da camada de dados
```

---

## 3. Modelo de dados (relacionamentos reais)

```mermaid
erDiagram
    CLIENTES      ||--o{ VEICULOS        : "possui (CASCADE)"
    VEICULOS      ||--o{ ORDENS_SERVICO  : "recebe atendimento (RESTRICT)"
    MECANICOS     ||--o{ ORDENS_SERVICO  : "executa (SET NULL)"
    FORNECEDORES  ||--o{ PECA            : "fornece (SET NULL)"
    ORDENS_SERVICO||--o{ ITENS_ORDEM     : "contém (CASCADE)"
    PECA          ||--o{ ITENS_ORDEM     : "é usada em (RESTRICT)"
    ORDENS_SERVICO||--o{ NOTIFICACOES    : "gera aviso (CASCADE)"
    CLIENTES      ||--o{ NOTIFICACOES    : "recebe aviso (SET NULL)"

    CLIENTES { int id PK, string nome, string telefone }
    VEICULOS { int id PK, int cliente_id FK, string placa }
    ORDENS_SERVICO { int id PK, int veiculo_id FK, int mecanico_id FK, string status }
    PECA { int id PK, int fornecedor_id FK, int quantidade }
    ITENS_ORDEM { int id PK, int ordem_servico_id FK, int peca_id FK }
    NOTIFICACOES { int id PK, int ordem_servico_id FK, int cliente_id FK }
```

| # | Tabela | Finalidade | Relacionamentos |
|---|--------|-----------|-----------------|
| 1 | `clientes` | Cadastro de clientes | 1:N com veículos e avisos |
| 2 | `veiculos` | Veículos de cada cliente | N:1 com clientes; 1:N com ordens |
| 3 | `mecanicos` | Equipe da oficina | 1:N com ordens |
| 4 | `fornecedores` | Fornecedores nacionais e importados | 1:N com peças |
| 5 | `pecas` | Catálogo + estoque + preços + moeda | N:1 com fornecedores; N:M com ordens via `itens_ordem` |
| 6 | `ordens_servico` | O que foi feito, quando, por quem e quanto | N:1 com veículos e mecânicos; 1:N com itens e avisos |
| 7 | `itens_ordem` | Peças usadas em cada ordem (quantidade e preço) | N:1 com ordens e peças |
| 8 | `notificacoes` | Histórico dos avisos enviados ao cliente | N:1 com ordens e clientes |

O DDL MySQL está em `src/main/database/schema.sql` (InnoDB, `utf8mb4`, `CHECK`, `UNIQUE`, índices nas FKs).

### Regras de negócio implementadas

- Ao adicionar/alterar/remover uma peça de uma OS, o **estoque é baixado/devolvido** e o **valor total da OS é recalculado** (`mão de obra + peças − desconto`) dentro de uma transação na mesma conexão.
- Não é possível excluir um cliente com veículos, um veículo com ordens ou uma peça usada em ordem — a FK bloqueia e a interface mostra uma mensagem clara.
- Peças podem ser **importadas**, com moeda `BRL` ou `USD`; a cotação do dólar pode ser registrada em cada OS.

---

## 4. APIs consumidas (todas sem chave)

| Recurso | Fonte | Onde aparece |
|---------|-------|--------------|
| Cotação USD/BRL (compra, venda, variação) | [AwesomeAPI](https://docs.awesomeapi.com.br/api-de-moedas) — `GET /json/last/USD-BRL` | Painel, aba Integrações e detalhe da OS |
| Cotação alternativa | [Banco Central (PTAX/OData)](https://dadosabertos.bcb.gov.br/dataset/dolar-americano-usd-todos-os-boletins-diarios) | Fallback automático se a AwesomeAPI falhar |
| Preços e versões da Tabela FIPE | [Preço FIPE](https://precofipe.com/docs) — `GET /v1/veiculos?marca=&modelo=` | Formulário de veículos e aba Integrações |
| Envio do aviso de retirada | Link `https://wa.me/<telefone>?text=<mensagem>` | Botão “Avisar cliente” no detalhe da OS |

### Sobre a consulta por placa

Não existe uma API brasileira de placa **realmente gratuita, estável e sem chave**. Para não introduzir credenciais, o sistema valida o formato (antigo `ABC1234` e Mercosul `ABC1D23`), tenta um endpoint público e, se não obtiver resposta, preenche com um **catálogo local demonstrativo**, avisando na tela que os dados são demonstrativos e precisam ser conferidos. Para usar dados oficiais depois, basta trocar `lookupPlate` em `src/main/services/plate.ts`.

---

## 5. Estrutura do projeto

```text
src/
├── main/
│   ├── index.ts                 # bootstrap: valida .env, conecta, abre a janela
│   ├── config.ts                # leitura/validação das variáveis do .env
│   ├── ipc.ts                   # handlers IPC (CRUD, OS, APIs, notificações)
│   ├── database/
│   │   ├── schema.sql           # 8 tabelas MySQL + FKs + índices
│   │   ├── mysql.ts             # pool/transações (mysql2/promise)
│   │   ├── connection.ts        # conexão + criação do schema
│   │   ├── repository.ts        # CRUD genérico + dashboard
│   │   └── ordens.ts            # itens da OS, estoque e total
│   └── services/                # câmbio, placa, FIPE, notificação
├── preload/index.ts             # contextBridge (API tipada para o renderer)
├── shared/                      # tipos e metadados das entidades
└── renderer/
    ├── index.html
    └── src/                     # shell, CRUD, dashboard, OS, integrações, UI/Tailwind
```

A comunicação renderer → main passa pelo `preload` via `contextBridge` + `ipcRenderer.invoke` (`contextIsolation` ligado e `nodeIntegration` desligado).

---

## 6. Testes

`npm test` executa o build e `scripts/smoke-test.cjs`, que valida:

- presença do `.env.example` e do `.env` no `.gitignore`;
- conexão, criação das 8 tabelas e registro dos handlers;
- CRUD completo das 8 entidades e resolução das FKs nas listagens;
- baixa/devolução de estoque e recálculo do total da OS (inclusive pelos CRUDs genéricos);
- bloqueio de exclusão por FK, `ON DELETE SET NULL` e link `wa.me` com DDI;
- dashboard, busca por colunas vindas de FK e chamadas reais às APIs.

Para não exigir um servidor na máquina de desenvolvimento, o teste substitui `mysql2` por um adaptador em memória que traduz o DDL MySQL para SQLite (via `node:sqlite` do Electron). **A aplicação real sempre usa MySQL/MariaDB.**

Para verificar a janela com um banco real configurado:

```powershell
$env:OFICINA_SMOKE = '1'
npx electron out/main/index.js
```
