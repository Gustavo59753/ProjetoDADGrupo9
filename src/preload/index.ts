import { contextBridge, ipcRenderer } from 'electron';
import type {
  ApiResponse,
  CepData,
  CnpjData,
  DollarQuote,
  EntityName,
  FipeVehicle,
  LookupResult,
  NotificationResult,
  PlateData,
} from '@shared/types';

function invoke<T>(channel: string, ...args: unknown[]): Promise<ApiResponse<T>> {
  return ipcRenderer.invoke(channel, ...args);
}

const api = {
  list: (entity: EntityName, search = '') => invoke<Record<string, unknown>[]>('db:list', entity, search),
  get: (entity: EntityName, id: number) => invoke<Record<string, unknown>>('db:get', entity, id),
  create: (entity: EntityName, data: Record<string, unknown>) =>
    invoke<Record<string, unknown>>('db:create', entity, data),
  update: (entity: EntityName, id: number, data: Record<string, unknown>) =>
    invoke<Record<string, unknown>>('db:update', entity, id, data),
  remove: (entity: EntityName, id: number) => invoke<null>('db:delete', entity, id),
  options: (entity: EntityName, label?: string) =>
    invoke<{ id: number; label: string }[]>('db:options', entity, label),
  dashboard: () => invoke<any>('db:dashboard'),

  listItems: (osId: number) => invoke<Record<string, unknown>[]>('os:items', osId),
  addItem: (osId: number, data: { peca_id: number; quantidade: number; preco_unitario?: number }) =>
    invoke<null>('os:addItem', osId, data),
  updateItem: (itemId: number, data: { peca_id: number; quantidade: number; preco_unitario?: number }) =>
    invoke<null>('os:updateItem', itemId, data),
  removeItem: (itemId: number) => invoke<null>('os:removeItem', itemId),
  setDollar: (osId: number, rate: number) => invoke<null>('os:setDollar', osId, rate),
  refreshCosts: (osId: number) => invoke<null>('os:refreshCosts', osId),
  notify: (osId: number, message?: string) => invoke<NotificationResult>('os:notify', osId, message),
  createNotification: (data: Record<string, unknown>) => invoke<NotificationResult>('notification:create', data),

  dollar: (force = false) => invoke<DollarQuote>('api:dollar', force),
  plate: (plate: string) => invoke<LookupResult<PlateData>>('db:plate', plate),
  fipe: (marca: string, modelo: string) => invoke<FipeVehicle[]>('api:fipe', marca, modelo),
  cep: (cep: string) => invoke<LookupResult<CepData>>('api:cep', cep),
  cnpj: (cnpj: string) => invoke<LookupResult<CnpjData>>('api:cnpj', cnpj),
  openExternal: (url: string) => invoke<null>('app:openExternal', url),
  clipboard: (text: string) => invoke<null>('app:clipboard', text),
};

contextBridge.exposeInMainWorld('oficina', api);

export type OficinaApi = typeof api;
