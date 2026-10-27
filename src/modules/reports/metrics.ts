/** Taxa de aprovação entre os trabalhos JÁ DECIDIDOS (0–1, 4 casas). Nenhum decidido → null. */
export function approvalRate(approved: number, rejected: number): number | null {
  const decided = approved + rejected;
  if (decided === 0) return null;
  return Math.round((approved / decided) * 10_000) / 10_000;
}

export function round2(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}
