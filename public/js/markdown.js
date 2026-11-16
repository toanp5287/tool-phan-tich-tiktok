/* Shared Markdown renderer + report normalizer. No external deps. */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
}

/** Render a Markdown string to safe HTML (headings, lists, tables, code, bold/italic). */
export function renderMarkdown(md) {
  const lines = String(md ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let listType = null;
  let table = false;
  let paragraph = [];
  let inCode = false;
  let codeLines = [];

  const flushParagraph = () => { if (paragraph.length) { out.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`); paragraph = []; } };
  const flushList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const flushTable = () => { if (table) { out.push("</tbody></table>"); table = false; } };

  for (const raw of lines) {
    const line = raw;
    if (inCode) {
      if (/^```/.test(line)) { out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`); codeLines = []; inCode = false; }
      else codeLines.push(line);
      continue;
    }
    if (/^```/.test(line)) { flushParagraph(); flushList(); flushTable(); inCode = true; codeLines = []; continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); flushList(); flushTable(); const level = heading[1].length; out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); continue; }
    const bullet = /^\s*([-*])\s+(.+)$/.exec(line);
    if (bullet) { flushParagraph(); flushTable(); if (listType !== "ul") { flushList(); out.push("<ul>"); listType = "ul"; } out.push(`<li>${inlineMarkdown(bullet[2])}</li>`); continue; }
    const numbered = /^\s*(\d+)[.)]\s+(.+)$/.exec(line);
    if (numbered) { flushParagraph(); flushTable(); if (listType !== "ol") { flushList(); out.push("<ol>"); listType = "ol"; } out.push(`<li>${inlineMarkdown(numbered[2])}</li>`); continue; }
    if (/^\|.*\|$/.test(line)) {
      flushParagraph(); flushList();
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
      if (!table) { out.push("<table><tbody>"); table = true; }
      out.push(`<tr>${cells.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`);
      continue;
    }
    if (!line.trim()) { flushParagraph(); flushList(); flushTable(); continue; }
    flushList(); flushTable(); paragraph.push(line.trim());
  }
  if (inCode) out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  flushParagraph(); flushList(); flushTable();
  return out.join("");
}

/** Strip a leading/trailing markdown code fence (```json / ```markdown / ```). */
function stripFence(text) {
  return String(text ?? "").trim().replace(/^```(?:json|markdown|md)?\s*/i, "").replace(/\s*```$/, "").trim();
}

/**
 * Normalize a Market Gap AI report payload into:
 * { format: 'json'|'markdown'|'text', title: string|null, sections: [{heading, content}], raw: string }
 * Handles `:report`/`:sections` keyword keys, plain `report`/`sections`, markdown and text.
 */
export function normalizeReport(report) {
  if (!report || typeof report !== "object") return { format: "text", title: null, sections: [], raw: "" };

  let content = report.content ?? report.markdown ?? report.text ?? report.report;
  // Some reports wrap the JSON inside the `content` string.
  let source = content;

  // Try to interpret `content` as JSON (possibly with :report/:sections).
  if (typeof source === "string") {
    const stripped = stripFence(source);
    if (stripped.startsWith("{") || stripped.startsWith("[")) {
      try {
        const parsed = JSON.parse(stripped);
        const title = parsed[":report"] ?? parsed.report ?? null;
        const sections = parsed[":sections"] ?? parsed.sections ?? null;
        if (Array.isArray(sections)) {
          return {
            format: "json",
            title: cleanHeading(typeof title === "string" ? title : null),
            sections: sections.map((s) => ({ heading: cleanHeading(s?.heading ?? ""), content: s?.content ?? "" })),
            raw: stripped,
          };
        }
        if (typeof title === "string") {
          return { format: "json", title: cleanHeading(title), sections: [], raw: stripped };
        }
      } catch { /* not JSON */ }
    }
  }

  // The report itself may already carry :report / :sections as parsed keys.
  const directTitle = report[":report"] ?? report.report ?? report.title ?? null;
  const directSections = report[":sections"] ?? report.sections ?? null;
  if (Array.isArray(directSections)) {
    return {
      format: "json",
      title: cleanHeading(typeof directTitle === "string" ? directTitle : null),
      sections: directSections.map((s) => ({ heading: cleanHeading(s?.heading ?? ""), content: s?.content ?? "" })),
      raw: typeof content === "string" ? content : "",
    };
  }

  // Fallback: treat content as markdown/plain text.
  const text = typeof content === "string" ? stripFence(content) : (typeof content === "object" && content !== null ? JSON.stringify(content, null, 2) : String(content ?? ""));
  const markdownLike = /^(#|##|###|\*\*|[-*]\s|\||>|`)/m.test(text) || /\n/.test(text);
  return { format: markdownLike ? "markdown" : "text", title: null, sections: [], raw: text };
}

/** Strip leading markdown heading markers so a heading renders as a plain title. */
function cleanHeading(text) {
  if (text === null || text === undefined) return null;
  const cleaned = String(text).replace(/^\s*#{1,6}\s*/, "").trim();
  return cleaned || String(text).trim();
}
