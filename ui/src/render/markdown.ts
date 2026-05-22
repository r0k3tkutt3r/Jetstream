import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const cache = new WeakMap<object, string>();
const keyFor = (msg: { id: string; content: string }) => ({ id: msg.id, content: msg.content });

export function renderMarkdown(msg: { id: string; content: string }): string {
  const k = keyFor(msg);
  let html = cache.get(k);
  if (html === undefined) {
    html = md.render(msg.content);
    cache.set(k, html);
  }
  return html;
}
