import type { PlateData } from '@shared/types';

const cache = new Map<string, PlateData>();

export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidPlate(value: string): boolean {
  return /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/.test(normalizePlate(value));
}

const CATALOG = [
  { marca: 'Volkswagen', modelo: 'Gol 1.0', ano: 2020, cor: 'Prata', combustivel: 'Flex' },
  { marca: 'Fiat', modelo: 'Argo 1.4', ano: 2021, cor: 'Vermelho', combustivel: 'Flex' },
  { marca: 'Toyota', modelo: 'Corolla XEi 2.0', ano: 2019, cor: 'Prata', combustivel: 'Flex' },
  { marca: 'Honda', modelo: 'Civic EXL 1.8', ano: 2018, cor: 'Preto', combustivel: 'Flex' },
  { marca: 'Chevrolet', modelo: 'Onix Plus 1.0', ano: 2022, cor: 'Branco', combustivel: 'Flex' },
  { marca: 'Hyundai', modelo: 'HB20 1.0', ano: 2020, cor: 'Azul', combustivel: 'Flex' },
  { marca: 'Renault', modelo: 'Kwid 1.0', ano: 2021, cor: 'Laranja', combustivel: 'Flex' },
  { marca: 'Ford', modelo: 'Ka 1.5', ano: 2019, cor: 'Cinza', combustivel: 'Flex' },
  { marca: 'Yamaha', modelo: 'Factor 150', ano: 2021, cor: 'Preto', combustivel: 'Gasolina' },
  { marca: 'Mercedes-Benz', modelo: 'Sprinter 415', ano: 2018, cor: 'Branco', combustivel: 'Diesel' },
];

function demoData(placa: string): PlateData {
  const hash = [...placa].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7);
  const item = CATALOG[hash % CATALOG.length];
  const ufList = ['SP', 'RJ', 'MG', 'PR', 'SC', 'RS', 'BA', 'PE'];
  return {
    placa,
    marca: item.marca,
    modelo: item.modelo,
    anoFabricacao: item.ano,
    anoModelo: item.ano + 1,
    cor: item.cor,
    combustivel: item.combustivel,
    municipio: 'São Paulo',
    uf: ufList[hash % ufList.length],
    chassi: null,
    source: 'demonstrativa',
    note: 'Dados demonstrativos (offline). APIs públicas de placa exigem chave; confira e ajuste os campos antes de salvar.',
  };
}

/** Tenta um provedor público sem chave; se não houver resposta, usa o catálogo demonstrativo. */
export async function lookupPlate(plate: string): Promise<PlateData> {
  const placa = normalizePlate(plate);
  if (!isValidPlate(placa)) throw new Error('Placa inválida. Use ABC1234 ou ABC1D23.');

  const hit = cache.get(placa);
  if (hit) return hit;

  let result: PlateData | null = null;
  try {
    // Endpoint público de teste da WebXcar (sem chave). Normalmente responde 401;
    // nesse caso o sistema recorre ao modo demonstrativo e avisa o usuário.
    const response = await fetch(`https://api.webxcar.com.br/placas/${placa}/basica`, {
      headers: { Accept: 'application/json', 'User-Agent': 'OficinaDesktop/1.0' },
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const json: any = await response.json();
      const dados = json?.data ?? json?.veiculo ?? json;
      const marca = dados?.marca?.nome ?? dados?.marca;
      const modelo = dados?.modelo?.nome ?? dados?.modelo;
      if (marca && modelo) {
        result = {
          placa,
          marca: String(marca),
          modelo: String(modelo),
          anoFabricacao: Number(dados.ano ?? dados.anoFabricacao) || null,
          anoModelo: Number(dados.anoModelo ?? dados.ano) || null,
          cor: dados.cor?.nome ?? dados.cor ?? null,
          combustivel: dados.combustivel?.nome ?? dados.combustivel ?? null,
          municipio: dados.municipio ?? null,
          uf: dados.uf ?? null,
          chassi: dados.chassi ?? null,
          source: 'publica',
          note: 'Dados obtidos de API pública.',
        };
      }
    }
  } catch {
    // provedor indisponível -> fallback
  }

  result ??= demoData(placa);
  cache.set(placa, result);
  return result;
}
