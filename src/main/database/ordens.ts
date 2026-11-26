import { getReadyDb } from './repository';

export interface ItemInput {
  peca_id: number;
  quantidade: number;
  preco_unitario?: number | string | null;
}

/** Recalcula o total somente itens ativos de uma OS ativa, com peças ativas. */
async function recalcTotal(osId: number): Promise<void> {
  const db = await getReadyDb();
  const row: any = await db.prepare(`
    SELECT COALESCE(SUM(i.subtotal), 0) AS pecas,
           (SELECT COALESCE(valor_mao_obra,0) - COALESCE(desconto,0)
              FROM ordens_servico WHERE id = ? AND ativo = 1) AS servico
      FROM itens_ordem i
      JOIN pecas p ON p.id = i.peca_id AND p.ativo = 1
     WHERE i.ordem_servico_id = ? AND i.ativo = 1
  `).get(osId, osId);
  await db.prepare('UPDATE ordens_servico SET valor_total = ? WHERE id = ? AND ativo = 1')
    .run(Number((Number(row.pecas) + Number(row.servico)).toFixed(2)), osId);
}

export async function listItems(osId: number): Promise<Record<string, any>[]> {
  const db = await getReadyDb();
  return db.prepare(`
    SELECT i.*, p.descricao AS peca_descricao, p.codigo AS peca_codigo,
           p.quantidade AS estoque_atual, p.moeda
      FROM itens_ordem i
      JOIN ordens_servico o ON o.id = i.ordem_servico_id AND o.ativo = 1
      JOIN pecas p ON p.id = i.peca_id AND p.ativo = 1
     WHERE i.ordem_servico_id = ? AND i.ativo = 1
     ORDER BY i.id
  `).all(osId);
}

export async function addItem(osId: number, input: ItemInput): Promise<number> {
  const db = await getReadyDb();
  const qty = Number(input.quantidade);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('Informe uma quantidade inteira maior que zero.');

  const pecaId = Number(input.peca_id);
  const rawUnit = input.preco_unitario;

  // Toda a validação e a baixa de estoque rodam na mesma conexão/transação.
  return db.transaction(async () => {
    const os = await db.prepare('SELECT id FROM ordens_servico WHERE id = ? AND ativo = 1').get(osId);
    if (!os) throw new Error('Ordem de serviço não encontrada.');

    const peca: any = await db.prepare(
      'SELECT id, preco_venda, quantidade, descricao FROM pecas WHERE id = ? AND ativo = 1'
    ).get(pecaId);
    if (!peca) throw new Error('Peça não encontrada.');

    const unit = rawUnit == null || rawUnit === '' ? Number(peca.preco_venda) : Number(rawUnit);
    if (!Number.isFinite(unit) || unit < 0) throw new Error('Preço unitário inválido.');

    // Consulta sem filtro de ativo justamente para reaproveitar um item inativado
    // (a UNIQUE (ordem_servico_id, peca_id) continua existindo).
    const existing: any = await db.prepare(
      'SELECT id, quantidade, ativo FROM itens_ordem WHERE ordem_servico_id = ? AND peca_id = ?'
    ).get(osId, peca.id);

    const reactivating = Boolean(existing && Number(existing.ativo) === 0);
    // Quando o item foi inativado, a quantidade antiga já voltou ao estoque:
    // a nova baixa é apenas da quantidade informada agora.
    const targetQty = reactivating ? qty : Number(existing?.quantidade ?? 0) + qty;
    if (targetQty > Number(peca.quantidade)) {
      throw new Error(`Estoque insuficiente de "${peca.descricao}". Disponível: ${peca.quantidade}.`);
    }

    const subtotal = Number((targetQty * unit).toFixed(2));
    let itemId = 0;
    if (existing) {
      itemId = Number(existing.id);
      await db.prepare(
        'UPDATE itens_ordem SET ativo = 1, quantidade = ?, preco_unitario = ?, subtotal = ? WHERE id = ?'
      ).run(targetQty, unit, subtotal, existing.id);
    } else {
      const inserted = await db.prepare(`
        INSERT INTO itens_ordem (ordem_servico_id, peca_id, quantidade, preco_unitario, subtotal, ativo)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(osId, peca.id, qty, unit, Number((qty * unit).toFixed(2)));
      itemId = inserted.lastInsertRowid;
    }

    await db.prepare('UPDATE pecas SET quantidade = quantidade - ? WHERE id = ? AND ativo = 1')
      .run(qty, peca.id);
    await recalcTotal(osId);
    return itemId;
  });
}

export async function updateItem(itemId: number, input: ItemInput): Promise<void> {
  const db = await getReadyDb();
  const item: any = await db.prepare(`
    SELECT i.id, i.ordem_servico_id, i.peca_id, i.quantidade
      FROM itens_ordem i
      JOIN ordens_servico o ON o.id = i.ordem_servico_id AND o.ativo = 1
     WHERE i.id = ? AND i.ativo = 1
  `).get(itemId);
  if (!item) throw new Error('Item não encontrado.');

  const qty = Number(input.quantidade);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('Informe uma quantidade inteira maior que zero.');

  const newPecaId = Number(input.peca_id);
  const peca: any = await db.prepare(
    'SELECT preco_venda, quantidade FROM pecas WHERE id = ? AND ativo = 1'
  ).get(newPecaId);
  if (!peca) throw new Error('Peça não encontrada.');

  const unit = input.preco_unitario == null || input.preco_unitario === ''
    ? Number(peca.preco_venda)
    : Number(input.preco_unitario);
  const available = Number(peca.quantidade) + (newPecaId === Number(item.peca_id) ? Number(item.quantidade) : 0);
  if (qty > available) throw new Error(`Estoque insuficiente. Disponível: ${available}.`);

  await db.transaction(async () => {
    try {
      await db.prepare(`
        UPDATE itens_ordem SET peca_id = ?, quantidade = ?, preco_unitario = ?, subtotal = ?
         WHERE id = ? AND ativo = 1
      `).run(newPecaId, qty, unit, Number((qty * unit).toFixed(2)), itemId);
    } catch (error: any) {
      const message = String(error?.message ?? '');
      if (error?.code === 'ER_DUP_ENTRY' || /duplicate entry|unique constraint failed/i.test(message)) {
        throw new Error('Já existe um item inativado com esta peça na ordem; reative-o em vez de criar outro vínculo.');
      }
      throw error;
    }
    await db.prepare('UPDATE pecas SET quantidade = quantidade + ? WHERE id = ? AND ativo = 1')
      .run(item.quantidade, item.peca_id);
    await db.prepare('UPDATE pecas SET quantidade = quantidade - ? WHERE id = ? AND ativo = 1')
      .run(qty, newPecaId);
    await recalcTotal(Number(item.ordem_servico_id));
  });
}

export async function removeItem(itemId: number): Promise<void> {
  const db = await getReadyDb();
  const item: any = await db.prepare(`
    SELECT i.id, i.ordem_servico_id, i.peca_id, i.quantidade
      FROM itens_ordem i
      JOIN ordens_servico o ON o.id = i.ordem_servico_id AND o.ativo = 1
     WHERE i.id = ? AND i.ativo = 1
  `).get(itemId);
  if (!item) throw new Error('Item não encontrado.');

  await db.transaction(async () => {
    await db.prepare('UPDATE pecas SET quantidade = quantidade + ? WHERE id = ? AND ativo = 1')
      .run(item.quantidade, item.peca_id);
    // Soft delete do item: mantém o histórico e libera a peça para reativar depois.
    await db.prepare('UPDATE itens_ordem SET ativo = 0 WHERE id = ? AND ativo = 1').run(itemId);
    await recalcTotal(Number(item.ordem_servico_id));
  });
}

export async function setDollar(osId: number, rate: number): Promise<void> {
  const db = await getReadyDb();
  await db.prepare('UPDATE ordens_servico SET cotacao_dolar = ? WHERE id = ? AND ativo = 1')
    .run(Number(rate), osId);
}

export async function refreshCosts(osId: number): Promise<void> {
  const db = await getReadyDb();
  const os: any = await db.prepare(
    'SELECT valor_mao_obra, desconto FROM ordens_servico WHERE id = ? AND ativo = 1'
  ).get(osId);
  if (!os) return;
  const row: any = await db.prepare(`
    SELECT COALESCE(SUM(i.subtotal),0) s
      FROM itens_ordem i
      JOIN pecas p ON p.id = i.peca_id AND p.ativo = 1
     WHERE i.ordem_servico_id = ? AND i.ativo = 1
  `).get(osId);
  const total = Number(row.s) + Number(os.valor_mao_obra) - Number(os.desconto);
  await db.prepare('UPDATE ordens_servico SET valor_total = ? WHERE id = ? AND ativo = 1')
    .run(Number(total.toFixed(2)), osId);
}
