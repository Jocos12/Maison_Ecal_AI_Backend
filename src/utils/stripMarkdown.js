/**
 * Strip Markdown so letters / e-mail bodies are plain text (newlines only).
 */
export function stripMarkdown(text = '') {
  let s = String(text || '').replace(/\r\n/g, '\n');
  s = s.replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, ''));
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  s = s.replace(/\*\*(.+?)\*\*/g, '$1');
  s = s.replace(/__(.+?)__/g, '$1');
  s = s.replace(/~~(.+?)~~/g, '$1');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,]|$)/g, '$1$2');
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,]|$)/g, '$1$2');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/^\s{0,3}>\s?/gm, '');
  s = s.replace(/^\s*[-*+]\s+/gm, '• ');
  s = s.replace(/\*{1,}/g, '');
  s = s.replace(/_{3,}/g, '');
  s = s.replace(/^[ \t]+/gm, '');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}
