import type { FipeVehicle } from '@shared/types';

/** API aberta do Preço FIPE (sem chave) — usada para sugerir marca/modelo e faixa de preço. */
export async function searchFipe(marca: string, modelo: string): Promise<FipeVehicle[]> {
  const params = new URLSearchParams();
  if (marca.trim()) params.set('marca', marca.trim());
  if (modelo.trim()) params.set('modelo', modelo.trim());
  if (![...params].length) return [];

  const response = await fetch(`https://precofipe.com/v1/veiculos?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'OficinaDesktop/1.0' },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`FIPE indisponível (HTTP ${response.status})`);

  const json: any = await response.json();
  return (json.resultados ?? []).map((r: any) => ({
    codigoFipe: r.codigo_fipe,
    marca: r.marca,
    modelo: r.modelo,
    tipo: r.tipo,
    precoMin: Number(r.preco?.min ?? 0),
    precoMax: Number(r.preco?.max ?? 0),
    anoMin: Number(r.anos?.min ?? 0),
    anoMax: Number(r.anos?.max ?? 0),
    referencia: r.mes_referencia ?? '',
  }));
}
