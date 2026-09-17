import { stripMarkdown } from './stripMarkdown.js';

export function letterToHtml(text = '') {
  const escaped = stripMarkdown(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const paras = escaped
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;font-family:Georgia,serif;font-size:15px;line-height:1.5;color:#111">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return `<div>${paras}</div>`;
}
