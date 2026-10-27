import { normalizeCep } from '../../utils/cep';

export interface CepAddress {
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

export class InvalidCepError extends Error {
  constructor(cep: string) {
    super(`CEP inválido: ${cep}`);
  }
}

export class CepNotFoundError extends Error {
  constructor(cep: string) {
    super(`CEP não encontrado: ${cep}`);
  }
}

/** ViaCEP fora do ar, lento demais ou respondendo erro 5xx após todas as tentativas */
export class ViaCepUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Serviço ViaCEP indisponível', { cause });
  }
}

interface ViaCepResponse {
  cep: string;
  logradouro: string;
  /** Faixa do CEP ("lado ímpar", "até 999/1000"), não o complemento do endereço: ignorado */
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean | 'true';
}

export interface ViaCepClientOptions {
  baseUrl: string;
  timeoutMs: number;
  retries: number;
  cacheTtlMs: number;
  maxCacheEntries?: number;
  backoffBaseMs?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
}

/** Erros em que vale a pena tentar de novo (rede, timeout, 5xx) */
class RetryableError extends Error {}

export class ViaCepClient {
  private readonly cache = new Map<string, { value: CepAddress; expiresAt: number }>();
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: ViaCepClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async lookup(rawCep: string): Promise<CepAddress> {
    const cep = normalizeCep(rawCep);
    if (!cep) throw new InvalidCepError(rawCep);

    const cached = this.cache.get(cep);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const value = await this.fetchWithRetry(cep);
    this.remember(cep, value);
    return value;
  }

  private remember(cep: string, value: CepAddress) {
    if (this.options.cacheTtlMs <= 0) return;
    const max = this.options.maxCacheEntries ?? 1000;
    if (this.cache.size >= max) {
      // Map preserva ordem de inserção: remove a entrada mais antiga
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(cep, { value, expiresAt: this.now() + this.options.cacheTtlMs });
  }

  private async fetchWithRetry(cep: string): Promise<CepAddress> {
    const backoffBase = this.options.backoffBaseMs ?? 200;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      if (attempt > 0) await sleep(backoffBase * 2 ** (attempt - 1));
      try {
        return await this.fetchOnce(cep);
      } catch (err) {
        if (!(err instanceof RetryableError)) throw err;
        lastError = err.cause ?? err;
      }
    }
    throw new ViaCepUnavailableError(lastError);
  }

  private async fetchOnce(cep: string): Promise<CepAddress> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.options.baseUrl}/${cep}/json/`, {
        signal: AbortSignal.timeout(this.options.timeoutMs),
        headers: { accept: 'application/json' },
      });
    } catch (err) {
      // falha de rede ou timeout (AbortSignal)
      throw new RetryableError('falha de rede', { cause: err });
    }

    if (response.status >= 500) throw new RetryableError(`HTTP ${response.status}`);
    if (response.status === 400) throw new InvalidCepError(cep);
    if (!response.ok) throw new ViaCepUnavailableError(new Error(`HTTP ${response.status}`));

    const body = (await response.json()) as ViaCepResponse;
    if (body.erro) throw new CepNotFoundError(cep);

    return {
      cep,
      street: body.logradouro,
      neighborhood: body.bairro,
      city: body.localidade,
      state: body.uf,
    };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
