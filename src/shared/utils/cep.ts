/** Remove máscara e retorna o CEP com 8 dígitos, ou null se inválido */
export function normalizeCep(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  return /^\d{8}$/.test(digits) ? digits : null;
}
