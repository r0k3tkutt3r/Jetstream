import MarkdownIt from "markdown-it";
import { codeToHtml, type BundledLanguage } from "shiki";

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const KNOWN_LANGS: Record<string, BundledLanguage> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx",
  rust: "rust", rs: "rust",
  py: "python", python: "python",
  sh: "bash", bash: "bash", shell: "bash", zsh: "bash",
  json: "json", yaml: "yaml", toml: "toml", md: "markdown",
};

const codeCache = new Map<string, string>();

// Custom fence renderer that fires shiki async-first; falls back to plain text.
md.renderer.rules.fence = (tokens, idx) => {
  const t = tokens[idx];
  const info = (t.info || "").trim();
  const lang = KNOWN_LANGS[info] ?? "txt";
  const key = `${lang}::${t.content}`;
  const cached = codeCache.get(key);
  if (cached) return cached;

  // Render plain shell first; kick off shiki upgrade in background
  const plain = `<pre class="shiki-pending"><code>${escapeHtml(t.content)}</code></pre>`;
  void codeToHtml(t.content, { lang: lang as BundledLanguage, theme: "github-dark" })
    .then((html) => { codeCache.set(key, html); })
    .catch(() => { codeCache.set(key, plain); });
  return plain;
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]!));
}

const messageCache = new WeakMap<object, string>();
const keyFor = (msg: { id: string; content: string }) => ({ id: msg.id, content: msg.content });

export function renderMarkdown(msg: { id: string; content: string }): string {
  const k = keyFor(msg);
  let html = messageCache.get(k);
  if (html === undefined) {
    html = md.render(msg.content);
    messageCache.set(k, html);
  }
  return html;
}
