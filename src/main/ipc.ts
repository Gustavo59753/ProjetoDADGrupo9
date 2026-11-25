import { ipcMain, shell, clipboard } from 'electron';
import { ENTITIES } from '@shared/schema';
import type { EntityName, NotificationChannel, NotificationResult } from '@shared/types';
import { normalizeDestination } from '@shared/validation';
import * as repo from './database/repository';
import * as ordens from './database/ordens';
import { getDollarQuote } from './services/exchange';
import { lookupPlate } from './services/plate';
import { searchFipe } from './services/fipe';
import { notifyReady } from './services/notification';
import { deliverNotification } from './services/notification-delivery';
import { lookupCep } from './services/cep';
import { lookupCnpj } from './services/cnpj';
import { validateClientInput } from './services/client-validation';
import { validateNotificationInput } from './services/notification-validation';
import { validateEmailInput } from './services/email-validation';

function assertEntity(value: string): EntityName {
  if (!(value in ENTITIES)) throw new Error(`Entidade desconhecida: ${value}`);
  return value as EntityName;
}

/** Aplica a validação de e-mail somente às entidades que possuem esse campo. */
function validateEntityEmail(name: EntityName, input: Record<string, unknown>): void {
  if (!input || !ENTITIES[name].fields.some((field) => field.key === 'email')) return;
  if (input.email === undefined) return;
  validateEmailInput(input);
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
    validateEntityEmail(name, input);
    let payload = input;
    if (name === 'clientes') validateClientInput(input);
    if (name === 'notificacoes') {
      validateNotificationInput(input);
      const canal = input.canal as NotificationChannel;
      payload = { ...input, destino: normalizeDestination(canal, String(input.destino)) };
    }
    if (name === 'itens_ordem') {
      const itemId = await ordens.addItem(Number(input.ordem_servico_id), {
        peca_id: Number(input.peca_id),
        quantidade: Number(input.quantidade),
        preco_unitario: input.preco_unitario as any,
      });
      return repo.get('itens_ordem', itemId);
    }
    const row = await repo.create(name, payload);
    if (name === 'ordens_servico') {
      await ordens.refreshCosts(Number(row.id));
      return repo.get(name, Number(row.id));
    }
    return row;
  });

  handle('db:update', async (entity: string, id: number, input: Record<string, unknown>) => {
    const name = assertEntity(entity);
    validateEntityEmail(name, input);
    const recordId = Number(id);
    let payload = input;
    if (name === 'clientes') validateClientInput(input);
    if (name === 'notificacoes') {
      // Updates parciais (ex.: apenas status) são validados contra o registro salvo.
      const current = await repo.get(name, recordId);
      if (input.destino !== undefined) {
        const canal = (input.canal ?? current?.canal) as NotificationChannel;
        payload = { ...input, destino: normalizeDestination(canal, String(input.destino)) };
      }
      validateNotificationInput({ ...current, ...payload });
    }
    if (name === 'itens_ordem') {
      await ordens.updateItem(recordId, {
        peca_id: Number(input.peca_id),
        quantidade: Number(input.quantidade),
        preco_unitario: input.preco_unitario as any,
      });
      return repo.get('itens_ordem', recordId);
    }
    const row = await repo.update(name, recordId, payload);
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

  handle('notification:create', async (input: Record<string, unknown>) => {
    validateNotificationInput(input);
    const canal = String(input.canal) as NotificationChannel;
    const destino = normalizeDestination(canal, String(input.destino));
    const mensagem = String(input.mensagem);

    const row = await repo.create('notificacoes', {
      ...input,
      canal,
      destino,
      mensagem,
      status: 'PENDENTE',
      erro: null,
    });
    const notificationId = Number(row.id);

    try {
      const delivery = await deliverNotification(canal, destino, mensagem);
      await repo.update('notificacoes', notificationId, { status: delivery.status });
      return {
        notificationId,
        message: mensagem,
        link: delivery.link,
        status: delivery.status,
      } satisfies NotificationResult;
    } catch {
      await repo.update('notificacoes', notificationId, {
        status: 'FALHA',
        erro: 'Não foi possível abrir o aplicativo nativo.',
      });
      throw new Error('Aviso salvo, mas o app não abriu. Confira o aviso na lista antes de tentar de novo.');
    }
  });

  handle('api:dollar', (force?: boolean) => getDollarQuote(Boolean(force)));
  handle('db:plate', (plate: string) => lookupPlate(plate));
  handle('api:fipe', (marca: string, modelo: string) => searchFipe(marca, modelo));
  handle('api:cep', (cep: string) => lookupCep(cep));
  handle('api:cnpj', (cnpj: string) => lookupCnpj(cnpj));

  handle('app:openExternal', (url: string) => shell.openExternal(url));
  handle('app:clipboard', (text: string) => clipboard.writeText(text));
}
