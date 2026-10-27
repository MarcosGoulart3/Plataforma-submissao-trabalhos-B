import { approvalRate, round2 } from './metrics';

describe('métricas do painel', () => {
  it('taxa de aprovação considera apenas trabalhos decididos', () => {
    expect(approvalRate(3, 1)).toBe(0.75);
    expect(approvalRate(1, 2)).toBe(0.3333);
    expect(approvalRate(0, 0)).toBeNull();
  });

  it('arredonda médias em 2 casas', () => {
    expect(round2(7.456)).toBe(7.46);
    expect(round2(null)).toBeNull();
  });
});
