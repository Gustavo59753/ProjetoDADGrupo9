# Oficina Manager — Gestão de Oficina Mecânica

Aplicativo desktop (Electron + TypeScript + Tailwind CSS) para organizar o atendimento de uma oficina mecânica: clientes, veículos, mecânicos, ordens de serviço, peças com estoque, fornecedores e avisos de retirada.

**Requisitos atendidos**

- Banco relacional **MySQL/MariaDB configurado por `.env`**, com **8 tabelas ligadas por chaves estrangeiras reais**.
- **CRUD completo nas 8 entidades** (criar, listar/buscar, editar e **inativar**, com soft delete), não apenas na tabela principal.
- **Consumo de APIs** sem chave: cotação do dólar, Tabela FIPE, CEP (ViaCEP) e CNPJ ([Minha Receita](https://minhareceita.org/)).
- **Cadastro de clientes PF/PJ** com validação local de CPF/CNPJ e **busca de placa no próprio banco de veículos** (sem API externa nem chaves).
- Aviso de veículo pronto por **WhatsApp (`wa.me`), SMS (`sms:`) ou e-mail (`mailto:`)** — o app só abre o aplicativo nativo, sem API paga.

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

- O app lê o `.env`, conecta e **cria as 8 tabelas se elas não existirem** (`CREATE TABLE IF NOT EXISTS`) — não é necessário rodar migrações manuais. Em bancos já existentes, a inicialização também garante as colunas novas de `clientes` (`tipo_pessoa`, `cep` e `numero`), a coluna `ativo` nas 8 tabelas e o CHECK atualizado de `notificacoes.status` via `src/main/database/migrations.ts`.
- **Nenhum dado de exemplo é inserido**: o banco começa vazio, pronto para os seus dados reais.
- Se o `.env` estiver ausente/incompleto ou a conexão falhar, aparece uma mensagem clara e o aplicativo é encerrado — ele não tenta usar um banco fallback.

### Migrações (colunas `ativo`)

`CREATE TABLE IF NOT EXISTS` não altera tabelas que já existem. Por isso a inicialização executa migrações idempotentes: `ALTER TABLE ... ADD COLUMN ativo TINYINT(1) NOT NULL DEFAULT 1` em cada uma das 8 tabelas (o erro de “coluna duplicada” é ignorado) e ajustes de CHECK quando necessário. `mecanicos` já possuía `ativo`; os demais passam a ter a coluna. Registros antigos são considerados ativos (`ativo = 1`) e **nenhuma linha é apagada** pela migração.

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

    CLIENTES { int id PK, string nome, string tipo_pessoa, string cpf_cnpj, string telefone, string cep, string endereco, string numero, string cidade, string uf, bool ativo }
    VEICULOS { int id PK, int cliente_id FK, string placa, bool ativo }
    ORDENS_SERVICO { int id PK, int veiculo_id FK, int mecanico_id FK, string status, bool ativo }
    PECA { int id PK, int fornecedor_id FK, int quantidade, bool ativo }
    ITENS_ORDEM { int id PK, int ordem_servico_id FK, int peca_id FK, bool ativo }
    NOTIFICACOES { int id PK, int ordem_servico_id FK, int cliente_id FK, bool ativo }
```

> **Decisão de modelo:** `CASCADE`, `RESTRICT` e `SET NULL` no diagrama descrevem as FKs **físicas** do DDL MySQL. Como as exclusões são lógicas (`UPDATE ... SET ativo = 0`), elas **não disparam** essas ações: o pai inativado permanece na tabela e os filhos mantêm o `..._id`. Para não exibir um nome perdido, as subqueries de rótulo (`cliente_nome`, `fornecedor_nome`, `mecanico_nome`, etc.) mostram `—` quando o pai está inativo. **Não há cascade lógico**: inativar um cliente não inativa seus veículos nem suas OS.

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

O DDL MySQL está em `src/main/database/schema.sql` (InnoDB, `utf8mb4`, `CHECK`, `UNIQUE`, índices nas FKs). Todas as 8 tabelas possuem `ativo TINYINT(1) NOT NULL DEFAULT 1`.

Em `clientes`, `tipo_pessoa` é `PF` (padrão) ou `PJ` e define se `cpf_cnpj` guarda um CPF ou um CNPJ; `cep` fica no formato `00000-000`, `numero` é o número do endereço e **`endereco` concentra logradouro e bairro em um único campo**, no formato `Logradouro, Bairro` (cidade e UF têm colunas próprias).

### Exclusão lógica (soft delete)

O comando “Excluir” da interface foi renomeado para **Inativar**. `db:delete` executa `UPDATE <tabela> SET ativo = 0 WHERE id = ?`: a linha permanece no MySQL para histórico/auditoria, mas desaparece de `db:list`, `db:get`, `db:options` (selects de FK) e do `db:dashboard`. Isso vale para as 8 entidades.

- Clientes com veículos, veículos com OS, peças usadas em OS e fornecedores com peças **podem ser inativados**: não há mais bloqueio por FK na rotina (a FK física continua no DDL, mas `UPDATE` não dispara `CASCADE`/`SET NULL`/`RESTRICT`).
- Inativar um pai **não** apaga nem anula os filhos (sem cascade lógico); os rótulos de FK mostram `—` quando o pai está inativo. Reative o registro antes de usá-lo novamente como referência.
- As constraints `UNIQUE` continuam valendo: se CPF/CNPJ, placa, código ou número pertence a um registro inativado, criar outro com o mesmo valor falha com mensagem amigável que **sugere reativação**.
- Em `itens_ordem`, `os:removeItem` e `db:delete` inativam a linha, **devolvem a quantidade ao estoque** e recalculam `valor_total`. Adicionar a mesma peça novamente na mesma OS **reativa a linha existente** (mesmo `id`, ajustando quantidade e subtotal) em vez de violar `UNIQUE (ordem_servico_id, peca_id)`; o estoque é baixado pela nova quantidade.

### Regras de negócio implementadas

- Ao adicionar/alterar/remover/reativar uma peça de uma OS, o **estoque é baixado/devolvido** e o **valor total da OS é recalculado** (`mão de obra + peças − desconto`) dentro de uma transação na mesma conexão.
- Exclusões são lógicas (veja acima): a FK física permanece no DDL, mas inativar registros **não** dispara `CASCADE`/`SET NULL`/`RESTRICT` e **não impede** a operação.
- Peças podem ser **importadas**, com moeda `BRL` ou `USD`; a cotação do dólar pode ser registrada em cada OS.
- O cadastro de clientes é separado por **tipo de pessoa**: `PF` informa CPF e `PJ` informa CNPJ. Os dígitos verificadores são conferidos **localmente** (sem rede) na criação e na atualização; documento inválido **bloqueia** a operação.
- **CEP via ViaCEP:** o status `invalid` (formato com menos de 8 dígitos) **bloqueia** o cadastro; `not_found` (CEP inexistente) e `unavailable` (falha de conexão/timeout) apenas **avisam** e deixam o preenchimento manual livre. Logradouro/bairro (campo `endereco`), cidade e UF são gravados **apenas nos campos que estiverem vazios**.
- **CNPJ de clientes PJ via Minha Receita:** preenche razão social/nome, CEP, endereço, cidade (campo `municipio` da API), UF e número **apenas em campos vazios**. `invalid` **bloqueia**; `not_found` (CNPJ inexistente) e `unavailable` (indisponibilidade da consulta) apenas **avisam** — o cliente pode ser cadastrado com preenchimento manual.
- **CNPJ de fornecedores via Minha Receita:** o lookup preenche razão social, contato, país e endereço nas observações **apenas em campos vazios**. Diferente de clientes, aqui `invalid`, `not_found` e `unavailable` **bloqueiam** `db:create`/`db:update`; em atualizações parciais sem alterar o CNPJ a consulta é pulada, para que uma queda de rede não impeça editar outros campos. No backend, o CNPJ é normalizado e os dados da Receita (`telefone`, `e-mail`, `situacao`, `complemento`) ficam disponíveis no resultado de `api:cnpj`/`window.oficina.cnpj`. Quando `descricao_situacao_cadastral` vem preenchida, o tooltip/status do campo de CNPJ menciona a situação (por exemplo, `ATIVA`).
- O **número do endereço é manual** por padrão: o valor trazido pela Minha Receita só é aproveitado quando o campo está vazio; a consulta de CEP nunca preenche esse campo.
- Em avisos, `notification:create` aceita `E-mail`, `Email`, `e-mail` e variações de caixa, normalizando tudo para `E-mail` antes de gravar e de abrir o rascunho `mailto:`. WhatsApp continua gerando link `wa.me` com status `ABERTO_NO_WHATSAPP`; SMS e e-mail usam status `ABERTO_NO_APP`.

---

## 4. APIs consumidas (todas sem chave)

| Recurso | Fonte | Onde aparece |
|---------|-------|--------------|
| Cotação USD/BRL (compra, venda, variação) | [AwesomeAPI](https://docs.awesomeapi.com.br/api-de-moedas) — `GET /json/last/USD-BRL` | Painel, aba Integrações e detalhe da OS |
| Cotação alternativa | [Banco Central (PTAX/OData)](https://dadosabertos.bcb.gov.br/dataset/dolar-americano-usd-todos-os-boletins-diarios) | Fallback automático se a AwesomeAPI falhar |
| Preços e versões da Tabela FIPE | [Preço FIPE](https://precofipe.com/docs) — `GET /v1/veiculos?marca=&modelo=` | Formulário de veículos e aba Integrações |
| Endereço por CEP (logradouro, bairro, cidade e UF) | [ViaCEP](https://viacep.com.br/) — `GET /ws/{cep}/json/` | Formulário de clientes |
| Dados da empresa por CNPJ (razão social, endereço, telefone, e-mail, situação e complemento) | [Minha Receita](https://minhareceita.org/) — `GET /{cnpj}` | Formulários de clientes (PJ) e fornecedores |
| Aviso por WhatsApp | Link `https://wa.me/<telefone>?text=<mensagem>` — status `ABERTO_NO_WHATSAPP` | Botão “Avisar cliente” no detalhe da OS |
| Aviso por SMS | Link `sms:<telefone>?body=<mensagem>` — status `ABERTO_NO_APP` | Cadastro de avisos |
| Aviso por e-mail | Link `mailto:<destino>?subject=<assunto>&body=<mensagem>` — status `ABERTO_NO_APP` | Cadastro de avisos |

Os três canais apenas abrem o aplicativo nativo do cliente (`shell.openExternal`), uma vez por aviso; não há API paga nem chave. O canal `Email` (sem hífen, em qualquer caixa) é aceito como alias de `E-mail` e normalizado antes da gravação.

### Sobre a consulta por placa

A busca por placa **não usa API externa** e não exige chave: o renderer chama o canal IPC `db:plate` e o processo principal consulta diretamente a tabela `veiculos` do MySQL/MariaDB configurado (`src/main/services/plate.ts`).

A placa é normalizada (maiúsculas, sem hífen ou espaço) e validada nos formatos antigo `ABC1234` e Mercosul `ABC1D23`; formato inválido retorna `invalid` e é recusado. Placa não cadastrada retorna `not_found` com aviso para preencher os dados manualmente, sem bloquear o cadastro. Quando encontrada, a consulta devolve marca, modelo, anos, cor, combustível, chassi e renavam **do próprio cadastro da oficina**, usados no formulário de veículos e na aba Integrações.

---

## 5. Estrutura do projeto

```text
src/
├── main/
│   ├── index.ts                 # bootstrap: valida .env, conecta, abre a janela
│   ├── config.ts                # leitura/validação das variáveis do .env
│   ├── ipc.ts                   # handlers IPC (CRUD, OS, CEP/CNPJ, placa, notificações)
│   ├── database/
│   │   ├── schema.sql           # 8 tabelas MySQL + FKs + UNIQUE + coluna ativo
│   │   ├── mysql.ts             # pool/transações (mysql2/promise)
│   │   ├── connection.ts        # conexão + criação do schema
│   │   ├── migrations.ts        # colunas de clientes, ativo nas 8 tabelas e CHECK de status
│   │   ├── repository.ts        # CRUD genérico (soft delete) + dashboard
│   │   └── ordens.ts            # itens da OS (inativar/reativar), estoque e total
│   └── services/
│       ├── exchange.ts          # cotação USD/BRL (AwesomeAPI + Banco Central)
│       ├── fipe.ts              # Tabela FIPE
│       ├── notification.ts      # aviso wa.me e histórico
│       ├── notification-validation.ts # validação/normalização do canal e do destino
│       ├── notification-delivery.ts   # deep links wa.me, sms: e mailto:
│       ├── plate.ts             # placa consultada na tabela veiculos (sem rede)
│       ├── lookup.ts            # fetch JSON com timeout e status normalizados
│       ├── cep.ts               # ViaCEP
│       ├── cnpj.ts              # CPF/CNPJ + Minha Receita (clientes e fornecedores)
│       └── client-validation.ts # validação de CEP/CPF/CNPJ no cadastro de clientes
├── preload/index.ts             # contextBridge (API tipada para o renderer)
├── shared/                      # tipos e metadados das entidades
└── renderer/
    ├── index.html
    └── src/                     # shell, CRUD, clientes, dashboard, OS, integrações, UI/Tailwind
        └── clientes.ts          # máscaras, consultas (ViaCEP/Minha Receita) e validação local
```

A comunicação renderer → main passa pelo `preload` via `contextBridge` + `ipcRenderer.invoke` (`contextIsolation` ligado e `nodeIntegration` desligado).

---

## 6. Testes

`npm test` executa o build e os testes em `scripts/` (`smoke-test.cjs` e `config-check.cjs`), que validam:

- presença do `.env.example` e do `.env` no `.gitignore`;
- conexão, criação das 8 tabelas, registro dos handlers e `PRAGMA table_info` confirmando `ativo TINYINT(1) NOT NULL DEFAULT 1` em **todas** as 8 tabelas (além das colunas `tipo_pessoa`, `cep`, `endereco`, `numero`, `cidade` e `uf` de `clientes`);
- CRUD completo das 8 entidades e resolução das FKs nas listagens, incluindo persistência e busca por CEP dos novos campos;
- validação local de CEP/CPF/CNPJ: documentos inválidos bloqueiam `db:create`, `api:cep` e `api:cnpj` retornam `invalid` e **nenhuma chamada de rede é feita**; CNPJ válido consulta a Minha Receita e mapeia `municipio` para cidade, `ddd_telefone_1` para telefone e `descricao_situacao_cadastral` para a situação exibida no tooltip/status;
- mock de `global.fetch` cobrindo `found`, `not_found` (HTTP 404, CNPJ `99999999000191`) e `unavailable` na Minha Receita: fornecedores **bloqueiam** `db:create`/`db:update` nos três casos de falha (e não bloqueiam edição sem alterar o CNPJ), enquanto clientes PJ com `not_found`/`unavailable` continuam sendo criados;
- busca de placa pelo canal `db:plate` **sem rede**: encontra veículo cadastrado (com placa normalizada), retorna `not_found` para placa inexistente e `invalid` para formato inválido, sem nenhuma requisição externa;
- **soft delete**: `db:delete` mantém a linha com `ativo = 0`, e `db:get`, `db:list`, `db:options` e `db:dashboard` ignoram registros inativados; FKs físicas não recebem cascade/SET NULL, e os rótulos de FK mostram `—` quando o pai está inativo; `UNIQUE` com valor inativado sugere reativação na mensagem de erro;
- baixa/devolução de estoque e recálculo do total da OS, incluindo a **reativação do mesmo item** (`os:addItem`/`db:create` com a mesma peça na mesma OS) e a inativação por `os:removeItem`/`db:delete`;
- avisos: link `wa.me` com DDI, `sms:` e `mailto:` (com assunto/corpo), incluindo o alias `Email` sem hífen normalizado para `E-mail` e persistido com status `ABERTO_NO_APP`;
- dashboard, busca por colunas vindas de FK e chamadas opcionais às APIs de câmbio e FIPE.

Para não exigir um servidor na máquina de desenvolvimento, o teste substitui `mysql2` por um adaptador em memória que traduz o DDL MySQL para SQLite (via `node:sqlite` do Electron). **A aplicação real sempre usa MySQL/MariaDB.**

Para verificar a janela com um banco real configurado:

```powershell
$env:OFICINA_SMOKE = '1'
npx electron out/main/index.js
```
