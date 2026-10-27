/** Data e hora no fuso do evento, para mensagens ao usuário (ex.: "10/05/2026, 09:00") */
export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
}
