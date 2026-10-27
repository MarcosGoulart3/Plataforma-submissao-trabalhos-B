import { BusinessRuleError, ServiceUnavailableError } from '../../shared/http/errors';
import { CepNotFoundError, viaCep, ViaCepUnavailableError } from '../../shared/infra/viacep';
import { mergeAddress } from './address';
import { usersRepository } from './users.repository';
import { usersService } from './users.service';

vi.mock('./users.repository', () => ({
  usersRepository: { upsertAddress: vi.fn(async (_id: string, address: unknown) => address) },
}));

const viaCepAddress = {
  cep: '96201460',
  street: 'Rua Eng. Alfredo Huch',
  neighborhood: 'Centro',
  city: 'Rio Grande',
  state: 'RS',
};

beforeEach(() => vi.restoreAllMocks());

describe('mergeAddress', () => {
  it('preenche com o ViaCEP o que o usuário não informou', () => {
    const { address, missing } = mergeAddress('96201460', { cep: '96201-460', number: '475' }, viaCepAddress);
    expect(missing).toEqual([]);
    expect(address).toMatchObject({ street: 'Rua Eng. Alfredo Huch', number: '475', city: 'Rio Grande', state: 'RS' });
    expect(address.complement).toBeNull();
  });

  it('complemento vem só do usuário', () => {
    const input = { cep: '96201460', number: '475', complement: 'apto 302' };
    expect(mergeAddress('96201460', input, viaCepAddress).address.complement).toBe('apto 302');
  });

  it('valor informado pelo usuário prevalece', () => {
    const { address } = mergeAddress('96201460', { cep: '96201460', number: '1', street: 'Av. Itália' }, viaCepAddress);
    expect(address.street).toBe('Av. Itália');
  });

  it('CEP genérico de cidade (sem logradouro) exige rua e bairro', () => {
    const generic = { ...viaCepAddress, street: '', neighborhood: '' };
    const { missing } = mergeAddress('96200000', { cep: '96200000', number: '1' }, generic);
    expect(missing).toEqual(['street', 'neighborhood']);
  });
});

describe('usersService.saveAddress', () => {
  it('salva o endereço autopreenchido', async () => {
    vi.spyOn(viaCep, 'lookup').mockResolvedValue(viaCepAddress);
    const saved = await usersService.saveAddress('u1', { cep: '96201-460', number: '475' });
    expect(saved).toMatchObject({ cep: '96201460', city: 'Rio Grande' });
  });

  it('CEP inexistente sem endereço digitado: 404 pedindo preenchimento manual', async () => {
    vi.spyOn(viaCep, 'lookup').mockRejectedValue(new CepNotFoundError('99999999'));
    await expect(usersService.saveAddress('u1', { cep: '99999999', number: '1' })).rejects.toMatchObject({
      statusCode: 404,
      code: 'CEP_NOT_FOUND',
      details: { missing: ['street', 'neighborhood', 'city', 'state'] },
    });
  });

  it('CEP inexistente: aceita endereço completo digitado manualmente', async () => {
    vi.spyOn(viaCep, 'lookup').mockRejectedValue(new CepNotFoundError('99999999'));
    const manual = { cep: '99999999', number: '10', street: 'Rua Nova', neighborhood: 'Cassino', city: 'Rio Grande', state: 'RS' };
    await expect(usersService.saveAddress('u1', manual)).resolves.toMatchObject({ cep: '99999999', street: 'Rua Nova' });
  });

  it('consulta de CEP inexistente responde 404', async () => {
    vi.spyOn(viaCep, 'lookup').mockRejectedValue(new CepNotFoundError('99999999'));
    await expect(usersService.lookupCep('99999999')).rejects.toMatchObject({ statusCode: 404, code: 'CEP_NOT_FOUND' });
  });

  it('ViaCEP fora do ar: aceita endereço completo digitado manualmente', async () => {
    vi.spyOn(viaCep, 'lookup').mockRejectedValue(new ViaCepUnavailableError(new Error('timeout')));
    const manual = {
      cep: '96201460',
      number: '475',
      street: 'Rua X',
      neighborhood: 'Centro',
      city: 'Rio Grande',
      state: 'RS',
    };
    await expect(usersService.saveAddress('u1', manual)).resolves.toMatchObject({ street: 'Rua X' });
    expect(usersRepository.upsertAddress).toHaveBeenCalled();
  });

  it('ViaCEP fora do ar e endereço incompleto: 503 pedindo preenchimento manual', async () => {
    vi.spyOn(viaCep, 'lookup').mockRejectedValue(new ViaCepUnavailableError(new Error('timeout')));
    const promise = usersService.saveAddress('u1', { cep: '96201460', number: '475' });
    await expect(promise).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('endereço incompleto mesmo com ViaCEP ok gera 422', async () => {
    vi.spyOn(viaCep, 'lookup').mockResolvedValue({ ...viaCepAddress, street: '' });
    await expect(usersService.saveAddress('u1', { cep: '96201460', number: '1' })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });
});
