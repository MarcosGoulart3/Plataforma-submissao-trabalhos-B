import { CepNotFoundError, InvalidCepError, ViaCepClient, ViaCepUnavailableError } from './viacep.client';

const okBody = {
  cep: '96201-460',
  logradouro: 'Rua Eng. Alfredo Huch',
  complemento: '',
  bairro: 'Centro',
  localidade: 'Rio Grande',
  uf: 'RS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeClient(fetchFn: typeof fetch, overrides: Partial<ConstructorParameters<typeof ViaCepClient>[0]> = {}) {
  return new ViaCepClient({
    baseUrl: 'https://viacep.test/ws',
    timeoutMs: 50,
    retries: 2,
    cacheTtlMs: 60_000,
    backoffBaseMs: 1,
    fetchFn,
    ...overrides,
  });
}

describe('ViaCepClient', () => {
  it('normaliza o CEP e mapeia a resposta', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(okBody));
    const client = makeClient(fetchFn);

    const address = await client.lookup('96201-460');

    expect(fetchFn).toHaveBeenCalledWith('https://viacep.test/ws/96201460/json/', expect.anything());
    expect(address).toEqual({
      cep: '96201460',
      street: 'Rua Eng. Alfredo Huch',
      neighborhood: 'Centro',
      city: 'Rio Grande',
      state: 'RS',
    });
  });

  it('ignora o "complemento" do ViaCEP, que é a faixa do CEP e não o endereço do usuário', async () => {
    const client = makeClient(vi.fn().mockResolvedValue(jsonResponse({ ...okBody, complemento: 'lado ímpar' })));
    expect(await client.lookup('96201460')).not.toHaveProperty('complement');
  });

  it('rejeita CEP mal formatado sem chamar a API', async () => {
    const fetchFn = vi.fn();
    await expect(makeClient(fetchFn).lookup('123')).rejects.toBeInstanceOf(InvalidCepError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('lança CepNotFoundError quando a API responde { erro: true }', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ erro: 'true' }));
    await expect(makeClient(fetchFn).lookup('99999999')).rejects.toBeInstanceOf(CepNotFoundError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('faz retry em erro 5xx e de rede e então tem sucesso', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(okBody));

    const address = await makeClient(fetchFn).lookup('96201460');

    expect(address.city).toBe('Rio Grande');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('lança ViaCepUnavailableError após esgotar as tentativas', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(makeClient(fetchFn).lookup('96201460')).rejects.toBeInstanceOf(ViaCepUnavailableError);
    expect(fetchFn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('respeita o timeout', async () => {
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }) as unknown as typeof fetch;

    await expect(makeClient(fetchFn, { retries: 0, timeoutMs: 10 }).lookup('96201460')).rejects.toBeInstanceOf(
      ViaCepUnavailableError,
    );
  });

  it('usa o cache até expirar o TTL', async () => {
    let now = 0;
    const fetchFn = vi.fn().mockImplementation(async () => jsonResponse(okBody));
    const client = makeClient(fetchFn, { cacheTtlMs: 1000, now: () => now });

    await client.lookup('96201460');
    await client.lookup('96201-460');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    now = 1001;
    await client.lookup('96201460');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
