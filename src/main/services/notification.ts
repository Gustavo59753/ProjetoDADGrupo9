import type { NotificationResult } from '@shared/types';
import { getDb } from '../database/connection';

interface OsRow {
  id: number;
  numero: string;
  valor_total: number;
  data_saida: string | null;
  cliente_id: number;
  cliente_nome: string | null;
  telefone: string | null;
  placa: string | null;
  modelo: string | null;
}

function buildMessage(os: OsRow): string {
  const veiculo = [os.modelo, os.placa ? `placa ${os.placa}` : ''].filter(Boolean).join(' - ');
  const total = Number(os.valor_total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const previsao = os.data_saida
    ? ` Previsão: ${new Date(`${String(os.data_saida).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}.`
    : '';
  return `Olá, ${os.cliente_nome?.split(' ')[0] ?? 'cliente'}! Seu veículo ${veiculo || `(OS ${os.numero})`} está pronto para retirada.${previsao} Valor do serviço: ${total}. Retire na oficina em nosso horário comercial. Obrigado!`;
}

/** Registra o aviso e devolve um link wa.me para envio sem API paga/chave. */
export async function notifyReady(osId: number, customMessage?: string): Promise<NotificationResult> {
  const db = getDb();
  const os: OsRow | undefined = await db.prepare(`
    SELECT o.id, o.numero, o.valor_total, o.data_saida,
           c.id AS cliente_id, c.nome AS cliente_nome, c.telefone,
           v.placa, v.modelo
      FROM ordens_servico o
      JOIN veiculos v ON v.id = o.veiculo_id
      JOIN clientes c ON c.id = v.cliente_id
     WHERE o.id = ?
  `).get(osId);

  if (!os) throw new Error('Ordem de serviço não encontrada.');

  const message = customMessage?.trim() || buildMessage(os);
  const digits = (os.telefone ?? '').replace(/\D/g, '');
  const phone = digits.length >= 10
    ? (digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`)
    : '';
  const link = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;

  const result = await db.prepare(`
    INSERT INTO notificacoes (ordem_servico_id, cliente_id, canal, destino, mensagem, status)
    VALUES (?, ?, 'WhatsApp', ?, ?, 'ABERTO_NO_WHATSAPP')
  `).run(osId, os.cliente_id, os.telefone ?? 'sem telefone', message);

  return {
    notificationId: result.lastInsertRowid,
    message,
    link,
    status: 'ABERTO_NO_WHATSAPP',
  };
}
