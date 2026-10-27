export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Monta texto puro e HTML a partir dos mesmos parágrafos */
export function layout(subject: string, greeting: string, paragraphs: string[]): RenderedEmail {
  const text = [greeting, '', ...paragraphs, '', '— Equipe Grande'].join('\n');
  const html = `<!doctype html>
<html lang="pt-BR"><body style="font-family: Arial, sans-serif; color: #222; line-height: 1.5">
<p>${escapeHtml(greeting)}</p>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
<p style="color: #666">— Equipe Grande</p>
</body></html>`;
  return { subject, text, html };
}
