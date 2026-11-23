import type { DollarQuote } from '@shared/types';

const CACHE_MS = 10 * 60 * 1000;
let cached: { at: number; quote: DollarQuote } | null = null;

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'OficinaDesktop/1.0' },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fromAwesomeApi(): Promise<DollarQuote> {
  const json = await getJson('https://economia.awesomeapi.com.br/json/last/USD-BRL');
  const usd = json?.USDBRL;
  if (!usd?.bid) throw new Error('Resposta inesperada da AwesomeAPI');
  return {
    bid: Number(usd.bid),
    ask: Number(usd.ask ?? usd.bid),
    variation: Number(usd.pctChange ?? 0),
    source: 'AwesomeAPI (USD/BRL)',
    fetchedAt: usd.create_date ? `${usd.create_date} (UTC-3)` : new Date().toLocaleString('pt-BR'),
  };
}

async function fromBacen(): Promise<DollarQuote> {
  // O BACEN publica a PTAX por data; tenta os últimos dias até encontrar um boletim.
  for (let i = 0; i < 12; i++) {
    const date = new Date(Date.now() - i * 86400000);
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${mm}-${dd}-${yyyy}'&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao`;
    try {
      const json = await getJson(url);
      const row = json?.value?.[0];
      if (row?.cotacaoVenda) {
        return {
          bid: Number(row.cotacaoCompra),
          ask: Number(row.cotacaoVenda),
          variation: 0,
          source: 'Banco Central do Brasil (PTAX)',
          fetchedAt: row.dataHoraCotacao,
        };
      }
    } catch {
      // tenta o dia anterior
    }
  }
  throw new Error('Não foi possível consultar a cotação no BACEN.');
}

/** Cotação do dólar sem chave de API, com cache e fonte alternativa. */
export async function getDollarQuote(force = false): Promise<DollarQuote> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.quote;

  let lastError = '';
  for (const provider of [fromAwesomeApi, fromBacen]) {
    try {
      const quote = await provider();
      cached = { at: Date.now(), quote };
      return quote;
    } catch (error: any) {
      lastError = error?.message ?? String(error);
    }
  }
  if (cached) return cached.quote; // usa cache expirado em vez de quebrar a tela
  throw new Error(`Cotação indisponível: ${lastError}`);
}
