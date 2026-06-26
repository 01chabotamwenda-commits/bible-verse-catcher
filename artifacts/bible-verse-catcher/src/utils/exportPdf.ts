import type { EnrichedVerse } from '@/hooks/useVerseDetection';

/**
 * Opens a print-to-PDF dialog with a nicely formatted verse sheet.
 * Works without any external dependency — uses window.print() with a
 * dedicated print stylesheet injected at runtime.
 */
export function exportToPdf(verses: EnrichedVerse[], sessionTitle?: string): void {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const title = sessionTitle || `Verse Catcher — ${date}`;

  const rows = verses.map((v) => {
    const badge = v.source === 'ai' ? 'AI' : 'Regex';
    const verif = v.verified ? '✓ Verified' : '⚠ Unverified';
    const text = v.verseText
      ? `<p class="verse-text">${v.verseText}</p>`
      : v.isPartial
      ? `<p class="verse-text muted">Chapter overview — ${v.suggestions.length} verses available</p>`
      : `<p class="verse-text muted">Verse text not in local data</p>`;

    return `
      <div class="verse-card">
        <div class="verse-header">
          <span class="verse-ref">${v.reference}</span>
          <span class="badge">${badge}</span>
          <span class="badge verif">${verif}</span>
        </div>
        ${text}
      </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 12pt;
      color: #1a1a1a;
      padding: 32pt 40pt;
      line-height: 1.6;
    }
    h1 { font-size: 18pt; margin-bottom: 4pt; }
    .subtitle { font-size: 10pt; color: #666; margin-bottom: 24pt; border-bottom: 1pt solid #ccc; padding-bottom: 8pt; }
    .verse-card { margin-bottom: 18pt; padding-bottom: 18pt; border-bottom: 0.5pt solid #e0e0e0; break-inside: avoid; }
    .verse-header { display: flex; align-items: center; gap: 8pt; margin-bottom: 6pt; }
    .verse-ref { font-size: 14pt; font-weight: bold; color: #7a5c00; }
    .badge { font-size: 8pt; padding: 1pt 5pt; border-radius: 10pt; border: 0.5pt solid #ccc; color: #555; font-family: Arial, sans-serif; }
    .verif { color: #2d7a2d; border-color: #2d7a2d; }
    .verse-text { font-size: 11pt; color: #333; }
    .verse-text.muted { color: #888; font-style: italic; }
    @page { margin: 0; }
    @media print { body { padding: 32pt 40pt; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="subtitle">${verses.length} verse${verses.length !== 1 ? 's' : ''} detected · Exported ${date}</p>
  ${rows || '<p style="color:#888;font-style:italic">No verses detected in this session.</p>'}
  <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}
