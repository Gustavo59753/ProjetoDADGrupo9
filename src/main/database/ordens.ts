import { getDb } from './connection';

export interface ItemInput {
  peca_id: number;
  quantidade: number;
  preco_unitario?: number | string | null;
}

async function recalcTotal(osId: number): Promise<void> {
  const db = getDb();
  const row: any = await db.prepare(`
    SELECT COALESCE(SUM(subtotal), 0) AS pecas,
           (SELECT COALESCE(valor_mao_obra,0) - COALESCE(desconto,0)
              FROM ordens_servico WHERE id = ?) AS servico
      FROM itens_ordem WHERE ordem_servico_id = ?
  `).get(osId, osId);
  await db.prepare('UPDATE ordens_servico SET valor_total = ? WHERE id = ?')
    .run(Number((Number(row.pecas) + Number(row.servico)).toFixed(2)), osId);
}

export async function listItems(osId: number): Promise<Record<string, any>[]> {
  return getDb().prepare(`
    SELECT i.*, p.descricao AS peca_descricao, p.codigo AS peca_codigo,
           p.quantidade AS estoque_atual, p.moeda
      FROM itens_ordem i
      JOIN pecas p ON p.id = i.peca_id
     WHERE i.ordem_servico_id = ?
     ORDER BY i.id
  `).all(osId);
}

export async function addItem(osId: number, input: ItemInput): Promise<number> {
  const db = getDb();
  const qty = Number(input.quantidade);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('Informe uma quantidade inteira maior que zero.');

  const peca: any = await db.prepare('SELECT id, preco_venda, quantidade, descricao FROM pecas WHERE id = ?')
    .get(Number(input.peca_id));
  if (!peca) throw new Error('Peça não encontrada.');

  const unit = input.preco_unitario == null || input.preco_unitario === ''
    ? Number(peca.preco_venda)
    : Number(input.preco_unitario);
  if (!Number.isFinite(unit) || unit < 0) throw new Error('Preço unitário inválido.');

  const existing: any = await db.prepare('SELECT id, quantidade FROM itens_ordem WHERE ordem_servico_id = ? AND peca_id = ?')
    .get(osId, peca.id);

  const totalQty = (existing?.quantidade ?? 0) + qty;
  if (totalQty > Number(peca.quantidade)) {
    throw new Error(`Estoque insuficiente de "${peca.descricao}". Disponível: ${peca.quantidade}.`);
  }

  let itemId = 0;
  await db.transaction(async () => {
    if (existing) {
      itemId = Number(existing.id);
      await db.prepare('UPDATE itens_ordem SET quantidade = ?, preco_unitario = ?, subtotal = ? WHERE id = ?')
        .run(totalQty, unit, Number((totalQty * unit).toFixed(2)), existing.id);
    } else {
      const inserted = await db.prepare(`INSERT INTO itens_ordem (ordem_servico_id, peca_id, quantidade, preco_unitario, subtotal)
                  VALUES (?, ?, ?, ?, ?)`)
        .run(osId, peca.id, qty, unit, Number((qty * unit).toFixed(2)));
      itemId = inserted.lastInsertRowid;
    }
    await db.prepare('UPDATE pecas SET quantidade = quantidade - ? WHERE id = ?').run(qty, peca.id);
    await recalcTotal(osId);
  });
  return itemId;
}

export async function updateItem(itemId: number, input: ItemInput): Promise<void> {
  const db = getDb();
  const item: any = await db.prepare('SELECT * FROM itens_ordem WHERE id = ?').get(itemId);
  if (!item) throw new Error('Item não encontrado.');

  const qty = Number(input.quantidade);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('Informe uma quantidade inteira maior que zero.');

  const peca: any = await db.prepare('SELECT preco_venda, quantidade FROM pecas WHERE id = ?')
    .get(Number(input.peca_id));
  if (!peca) throw new Error('Peça não encontrada.');

  const unit = input.preco_unitario == null || input.preco_unitario === ''
    ? Number(peca.preco_venda)
    : Number(input.preco_unitario);
  const available = Number(peca.quantidade) + Number(item.quantidade);
  if (qty > available) throw new Error(`Estoque insuficiente. Disponível: ${available}.`);

  await db.transaction(async () => {
    await db.prepare(`UPDATE itens_ordem SET peca_id = ?, quantidade = ?, preco_unitario = ?, subtotal = ? WHERE id = ?`)
      .run(Number(input.peca_id), qty, unit, Number((qty * unit).toFixed(2)), itemId);
    await db.prepare('UPDATE pecas SET quantidade = quantidade + ? WHERE id = ?').run(item.quantidade, item.peca_id);
    await db.prepare('UPDATE pecas SET quantidade = quantidade - ? WHERE id = ?').run(qty, Number(input.peca_id));
    await recalcTotal(Number(item.ordem_servico_id));
  });
}

export async function removeItem(itemId: number): Promise<void> {
  const db = getDb();
  const item: any = await db.prepare('SELECT * FROM itens_ordem WHERE id = ?').get(itemId);
  if (!item) throw new Error('Item não encontrado.');

  await db.transaction(async () => {
    await db.prepare('UPDATE pecas SET quantidade = quantidade + ? WHERE id = ?').run(item.quantidade, item.peca_id);
    await db.prepare('DELETE FROM itens_ordem WHERE id = ?').run(itemId);
    await recalcTotal(Number(item.ordem_servico_id));
  });
}

export async function setDollar(osId: number, rate: number): Promise<void> {
  await getDb().prepare('UPDATE ordens_servico SET cotacao_dolar = ? WHERE id = ?').run(Number(rate), osId);
}

export async function refreshCosts(osId: number): Promise<void> {
  const db = getDb();
  const os: any = await db.prepare('SELECT valor_mao_obra, desconto FROM ordens_servico WHERE id = ?').get(osId);
  if (!os) return;
  const row: any = await db.prepare('SELECT COALESCE(SUM(subtotal),0) s FROM itens_ordem WHERE ordem_servico_id = ?').get(osId);
  const total = Number(row.s) + Number(os.valor_mao_obra) - Number(os.desconto);
  await db.prepare('UPDATE ordens_servico SET valor_total = ? WHERE id = ?').run(Number(total.toFixed(2)), osId);
}
