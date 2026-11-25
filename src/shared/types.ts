export type EntityName =
  | 'clientes'
  | 'veiculos'
  | 'mecanicos'
  | 'fornecedores'
  | 'ordens_servico'
  | 'pecas'
  | 'itens_ordem'
  | 'notificacoes';

/** Tipo de pessoa no cadastro de clientes: física (PF) ou jurídica (PJ). */
export type PersonType = 'PF' | 'PJ';

/** Resultado de consultas a APIs externas: `invalid` bloqueia, `unavailable` apenas avisa. */
export type LookupResult<T> =
  | { status: 'found'; data: T }
  | { status: 'invalid' | 'not_found' | 'unavailable'; message: string };

export interface CepData {
  cep: string;
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
  complemento?: string;
  ibge?: string;
  gia?: string;
  ddd?: string;
  siafi?: string;
}

export interface CnpjData {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

export type FieldType =
  | 'text'
  | 'number'
  | 'money'
  | 'date'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'ref';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  readonly?: boolean;
  options?: string[];
  /** Entidade referenciada quando type === 'ref' */
  ref?: EntityName;
  /** Rótulo da entidade referenciada usado no <select> */
  refLabel?: string;
  placeholder?: string;
  hint?: string;
  full?: boolean;
}

export interface ListColumn {
  key: string;
  label: string;
  /** Tipo especial de renderização na tabela */
  render?: 'money' | 'badge' | 'date' | 'checkbox' | 'text';
}

export interface EntityMeta {
  label: string;
  singular: string;
  icon: string;
  table: string;
  primaryKey: string;
  columns: string[];
  fields: FieldDef[];
  listColumns: ListColumn[];
  searchColumns: string[];
  /** Subqueries SQL para trazer rótulos de chaves estrangeiras */
  joins?: string[];
  defaultOrder: string;
}

export interface DollarQuote {
  bid: number;
  ask: number;
  variation: number;
  source: string;
  fetchedAt: string;
}

/** Dados de um veículo do cadastro local, usados para preencher o formulário. */
export interface PlateData {
  placa: string;
  marca: string | null;
  modelo: string | null;
  anoFabricacao: number | null;
  anoModelo: number | null;
  cor: string | null;
  combustivel: string | null;
  chassi: string | null;
  renavam: string | null;
}

export interface FipeVehicle {
  codigoFipe: string;
  marca: string;
  modelo: string;
  tipo: string;
  precoMin: number;
  precoMax: number;
  anoMin: number;
  anoMax: number;
  referencia: string;
}

export interface NotificationResult {
  notificationId: number;
  message: string;
  link: string;
  status: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
