import { env } from '../../config/env';
import { ViaCepClient } from './viacep.client';

export * from './viacep.client';

export const viaCep = new ViaCepClient({
  baseUrl: env.VIACEP_BASE_URL,
  timeoutMs: env.VIACEP_TIMEOUT_MS,
  retries: env.VIACEP_RETRIES,
  cacheTtlMs: env.VIACEP_CACHE_TTL_SECONDS * 1000,
});
