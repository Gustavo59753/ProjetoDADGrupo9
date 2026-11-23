import { ipcMain, shell, clipboard } from 'electron';
import { ENTITIES } from '@shared/schema';
import type { EntityName } from '@shared/types';
import * as repo from './database/repository';
import * as ordens from './database/ordens';
import { getDollarQuote } from './services/exchange';
import { lookupPlate } from './services/plate';
import { searchFipe } from './services/fipe';
import { notifyReady } from './services/notification';

function assertEntity(value: string): EntityName {
  if (!(value in ENTITIES)) throw new Error(`Entidade desconhecida: ${value}`);
  return value as EntityName;
}

/** Envolve todos os handlers para que o renderer receba { ok, data, error }. */
function handle(channel: string, fn: (...args: any[]) => any): void {
  ipcMain.handle(channel, async (_event, ...args: any[]) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  });
}

export function registerIpc(): void {
  handle('db:list', (entity: string, search?: string) => repo.list(assertEntity(entity), search ?? ''));
  handle('db:get', (entity: string, id: number) => repo.get(assertEntity(entity), Number(id)));

  handle('db:create', async (entity: string, input: Record<string, unknown>) => {
    const name = assertEntity(entity);
    if (name === 'itens_ordem') {
      const itemId = await ordens.addItem(Number(input.ordem_servico_id), {
        peca_id: Number(input.peca_id),
        quantidade: Number(input.quantidade),
        preco_unitario: input.preco_unitario as any,
      });
      return repo.get('itens_ordem', itemId);
    }
    const row = await repo.create(name, input);
    if (name === 'ordens_servico') {
      await ordens.refreshCosts(Number(row.id));
      return repo.get(name, Number(row.id));
    }
    return row;
  });

  handle('db:update', async (entity: string, id: number, input: Record<string, unknown>) => {
    const name = assertEntity(entity);
    const recordId = Number(id);
    if (name === 'itens_ordem') {
      await ordens.updateItem(recordId, {
        peca_id: Number(input.peca_id),
        quantidade: Number(input.quantidade),
        preco_unitario: input.preco_unitario as any,
      });
      return repo.get('itens_ordem', recordId);
    }
    const row = await repo.update(name, recordId, input);
    if (name === 'ordens_servico') {
      await ordens.refreshCosts(recordId);
      return repo.get(name, recordId);
    }
    return row;
  });

  handle('db:delete', async (entity: string, id: number) => {
    const name = assertEntity(entity);
    if (name === 'itens_ordem') {
      await ordens.removeItem(Number(id));
      return null;
    }
    await repo.remove(name, Number(id));
    return null;
  });

  handle('db:options', (entity: string, label?: string) => repo.options(assertEntity(entity), label));
  handle('db:dashboard', () => repo.dashboard());

  handle('os:items', (osId: number) => ordens.listItems(Number(osId)));
  handle('os:addItem', (osId: number, input: ordens.ItemInput) => ordens.addItem(Number(osId), input));
  handle('os:updateItem', (itemId: number, input: ordens.ItemInput) => ordens.updateItem(Number(itemId), input));
  handle('os:removeItem', (itemId: number) => ordens.removeItem(Number(itemId)));
  handle('os:setDollar', (osId: number, rate: number) => ordens.setDollar(Number(osId), Number(rate)));
  handle('os:refreshCosts', (osId: number) => ordens.refreshCosts(Number(osId)));

  handle('os:notify', async (osId: number, message?: string) => {
    const result = await notifyReady(Number(osId), message);
    await shell.openExternal(result.link);
    return result;
  });

  handle('api:dollar', (force?: boolean) => getDollarQuote(Boolean(force)));
  handle('api:plate', (plate: string) => lookupPlate(plate));
  handle('api:fipe', (marca: string, modelo: string) => searchFipe(marca, modelo));

  handle('app:openExternal', (url: string) => shell.openExternal(url));
  handle('app:clipboard', (text: string) => clipboard.writeText(text));
}
