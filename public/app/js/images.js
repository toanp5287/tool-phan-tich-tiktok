/**
 * Fallback ảnh thông minh cho toàn bộ dashboard (light theme).
 *
 * Mục tiêu: KHÔNG bao giờ để khung ảnh bị vỡ/trống khi `imageUrl`, `coverUrl`,
 * `avatarUrl` hoặc `bannerUrl` bị null/undefined hoặc tải lỗi.
 *
 * - Avatar/creator/shop: dùng `ui-avatars.com` với chữ cái đầu + gradient theo tên.
 * - Sản phẩm / banner / video cover: dùng placeholder SVG nội bộ (gradient + glyph
 *   thương mại điện tử + chữ cái đầu), không phụ thuộc mạng nên không thể vỡ.
 */

const AVATAR_PALETTE = [
  ["2563eb", "1d4ed8"],
  ["0891b2", "0e7490"],
  ["16a34a", "15803d"],
  ["d97706", "b45309"],
  ["7c3aed", "6d28d9"],
  ["dc2626", "b91c1c"],
];

const PRODUCT_PALETTE = [
  ["eff6ff", "dbeafe", "2563eb"],
  ["ecfeff", "cffafe", "0891b2"],
  ["f0fdf4", "dcfce7", "16a34a"],
  ["fffbeb", "fef3c7", "d97706"],
  ["f5f3ff", "ede9fe", "7c3aed"],
  ["fef2f2", "fee2e2", "dc2626"],
];

/** Chữ cái đầu (tối đa 2 ký tự) từ tên hiển thị. */
export function initials(name) {
  const text = String(name || "").trim();
  if (!text) return "?";
  return text
    .split(/\s+/)
    .slice(-2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Băm ổn định theo tên để chọn màu gradient cố định. */
function hashIndex(text, length) {
  let hash = 0;
  const value = String(text || "");
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 1000003;
  }
  return Math.abs(hash) % length;
}

/** Avatar chữ cái gradient qua ui-avatars.com. */
export function avatarFallback(name, size = 128) {
  const label = initials(name);
  const [background, color] = AVATAR_PALETTE[hashIndex(name, AVATAR_PALETTE.length)];
  const params = new URLSearchParams({
    name: label,
    background,
    color,
    bold: "true",
    size: String(size),
    "font-size": "0.4",
  });
  return `https://ui-avatars.com/api/?${params.toString()}`;
}

/**
 * Placeholder SVG nội bộ cho sản phẩm/banner/video cover.
 * Trả về data URI nên luôn hiển thị, kể cả khi mất mạng.
 */
export function productPlaceholder(name, options = {}) {
  const kind = options.kind || "product";
  const width = options.width || 320;
  const height = options.height || 320;
  const label = initials(name);
  const [from, to, ink] = PRODUCT_PALETTE[hashIndex(name, PRODUCT_PALETTE.length)];
  const glyph =
    kind === "banner"
      ? `<rect x="${width * 0.36}" y="${height * 0.34}" width="${width * 0.28}" height="${height * 0.3}" rx="10" fill="none" stroke="${ink}" stroke-width="3" opacity="0.5"/>`
      : `<path d="M${width * 0.36} ${height * 0.42} h${width * 0.28} l${width * 0.035} ${height * 0.24} h-${width * 0.35} z" fill="none" stroke="${ink}" stroke-width="3" stroke-linejoin="round" opacity="0.45"/>
         <path d="M${width * 0.46} ${height * 0.42} a${width * 0.04} ${height * 0.05} 0 0 1 ${width * 0.08} 0" fill="none" stroke="${ink}" stroke-width="3" opacity="0.45"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#${from}"/>
        <stop offset="100%" stop-color="#${to}"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    ${glyph}
    <text x="50%" y="80%" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${Math.round(
      Math.min(width, height) * 0.16,
    )}" font-weight="700" fill="#${ink}" opacity="0.85">${escapeXml(label)}</text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Ảnh hợp lệ (chuỗi không rỗng) hay không. */
export function hasImage(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Trả về URL ảnh dùng được ngay: ưu tiên ảnh gốc, fallback theo loại.
 * @param {string|null|undefined} raw
 * @param {string} name
 * @param {"avatar"|"product"|"banner"|"cover"} kind
 */
export function resolveImage(raw, name, kind = "product") {
  if (hasImage(raw)) return raw;
  if (kind === "avatar") return avatarFallback(name);
  return productPlaceholder(name, { kind });
}

/** Ảnh dự phòng khi ảnh gốc tải lỗi (dùng trong @error). */
export function fallbackFor(name, kind = "product") {
  if (kind === "avatar") return avatarFallback(name);
  return productPlaceholder(name, { kind });
}

/** CSS background-image an toàn cho banner shop. */
export function bannerStyle(raw, name) {
  const url = resolveImage(raw, name, "banner");
  return { backgroundImage: `url("${url}")` };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
