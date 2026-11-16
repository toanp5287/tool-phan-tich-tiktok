import { apiGet, formatDate, formatNumber, mountApp } from "./shared.js";

const statusLabels = { COMPLETED: "HOÀN THÀNH", RUNNING: "ĐANG PHÂN TÍCH", FAILED: "THẤT BẠI" };
const query = new URLSearchParams(location.search);
const reportId = query.get("id");

function statusLabel(status) { return statusLabels[String(status || "").trim().toUpperCase()] || "KHÔNG XÁC ĐỊNH"; }

/** Minimal, safe Markdown renderer (headings, paragraphs, lists, tables, code, bold, inline code). No external deps. */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
}
function renderMarkdown(md) {
  const lines = String(md ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let listType = null;
  let table = null;
  let paragraph = [];
  let inCode = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (paragraph.length) { out.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`); paragraph = []; }
  };
  const flushList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const flushTable = () => { if (table) { out.push("</tbody></table>"); table = null; } };

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
    const isTableRow = /^\|.*\|$/.test(line);
    if (isTableRow) {
      flushParagraph(); flushList();
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue; // separator
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

mountApp({ setup() {
  const { ref, computed, onMounted } = Vue;
  const report = ref(null); const loading = ref(true); const error = ref("");
  const productUrl = computed(() => report.value?.productId
    ? `/detail.html?id=${report.value.productId}`
    : '/app/?view=products');
  const rawContent = computed(() => {
    const value = report.value?.report;
    if (typeof value === "string") return value;
    if (value && typeof value === "object") { try { return JSON.stringify(value, null, 2); } catch { return ""; } }
    return value ? String(value) : "";
  });
  const format = computed(() => {
    const f = report.value?.format;
    if (f === "markdown" || f === "json" || f === "text") return f;
    return /^(#|##|###|\*\*|[-*]\s|\||>|`)/m.test(rawContent.value) ? "markdown" : "text";
  });
  const contentHtml = computed(() => format.value === "markdown" ? renderMarkdown(rawContent.value) : "");

  async function reload() {
    loading.value = true;
    error.value = "";
    try {
      if (!/^[1-9]\d*$/.test(reportId || "")) throw new Error("ID báo cáo không hợp lệ");
      report.value = (await apiGet(`/api/ai-analysis/${reportId}`)).data;
      if (report.value.status === "FAILED") error.value = report.value.errorMessage || "Phân tích thất bại. Hãy quay lại sản phẩm để thử lại.";
      else if (report.value.status === "RUNNING") error.value = "Báo cáo đang được xử lý. Bạn có thể tải lại sau.";
      else if (!rawContent.value) error.value = "Báo cáo không có nội dung.";
    } catch (err) {
      error.value = err.message ?? String(err);
    } finally {
      loading.value = false;
    }
  }
  onMounted(reload);
  return { report, loading, error, productUrl, rawContent, format, contentHtml, statusLabel, reload, formatDate, formatNumber };
} });
