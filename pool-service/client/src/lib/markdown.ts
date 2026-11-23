/**
 * A very small Markdown subset for the app's own fixed texts (Terms, Privacy): # and ## headings,
 * paragraphs, "- " and "1. " lists, **bold**, and email addresses as links. Input is escaped first,
 * so only these tags can appear. Same subset as gpf/docs/make-pdf.cjs.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/([\w.+-]+@[\w-]+\.[\w.-]+\w)/g, '<a href="mailto:$1">$1</a>');

export function renderMarkdown(md: string, values: Record<string, string> = {}): string {
  const html: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const close = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };
  for (const line of md.replace(/\{\{(\w+)\}\}/g, (m, k: string) => values[k] ?? m).split('\n')) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,2}) (.*)$/))) {
      flush();
      close();
      html.push(`<h${m[1]!.length + 1}>${inline(m[2]!)}</h${m[1]!.length + 1}>`);
    } else if ((m = line.match(/^(- |\d+\. )(.*)$/))) {
      flush();
      const kind = m[1] === '- ' ? 'ul' : 'ol';
      if (list !== kind) {
        close();
        html.push(`<${kind}>`);
        list = kind;
      }
      html.push(`<li>${inline(m[2]!)}</li>`);
    } else if (!line.trim()) {
      flush();
      close();
    } else {
      close();
      para.push(line.trim());
    }
  }
  flush();
  close();
  return html.join('\n');
}
