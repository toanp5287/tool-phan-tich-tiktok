/**
 * Lưới an toàn ảnh toàn cục cho các trang legacy (public/*.html).
 *
 * Bắt mọi sự kiện `error` của <img> ở pha capture (error không bubble) và thay
 * bằng ảnh fallback chuyên nghiệp:
 *  - avatar/shop/creator  -> ui-avatars.com (chữ cái gradient theo tên)
 *  - sản phẩm/banner/video -> placeholder SVG nội bộ (luôn hiển thị)
 *
 * Ngoài ra tự gắn fallback cho <img> có src rỗng/null (kể cả khi Vue render
 * xong muộn) nhờ MutationObserver + quét định kỳ ngắn.
 */
import { fallbackFor, hasImage } from "/app/js/images.js";

const KIND_BY_CLASS = [
  ["avatar", "avatar"],
  ["video-cover", "cover"],
  ["video-thumb", "cover"],
  ["shop-banner", "banner"],
  ["banner", "banner"],
  ["thumb", "product"],
];

function inferKind(img) {
  const explicit = img.getAttribute("data-fallback-kind");
  if (explicit) return explicit;
  const className = String(img.className || "");
  for (const [token, kind] of KIND_BY_CLASS) {
    if (className.includes(token)) return kind;
  }
  return "product";
}

function nameFor(img) {
  return (
    img.getAttribute("data-fallback-name") ||
    img.getAttribute("alt") ||
    img.getAttribute("title") ||
    "TikTok Shop"
  );
}

function applyFallback(img) {
  if (!(img instanceof HTMLImageElement)) return;
  const kind = inferKind(img);
  const fallback = fallbackFor(nameFor(img), kind);
  if (img.getAttribute("src") === fallback) return;
  const attempts = Number(img.dataset.fallbackAttempts || "0");
  if (attempts >= 3) return;
  img.dataset.fallbackAttempts = String(attempts + 1);
  img.referrerPolicy = img.referrerPolicy || "no-referrer";
  img.src = fallback;
}

function scan(root = document) {
  for (const img of root.querySelectorAll("img")) {
    if (!hasImage(img.getAttribute("src"))) applyFallback(img);
  }
}

document.addEventListener(
  "error",
  (event) => {
    const target = event.target;
    if (target instanceof HTMLImageElement) applyFallback(target);
  },
  true,
);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => scan());
} else {
  scan();
}

const observer = new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === "attributes" && record.target instanceof HTMLImageElement) {
      if (!hasImage(record.target.getAttribute("src"))) applyFallback(record.target);
      continue;
    }
    for (const node of record.addedNodes) {
      if (node instanceof HTMLImageElement) {
        if (!hasImage(node.getAttribute("src"))) applyFallback(node);
      } else if (node instanceof HTMLElement) {
        scan(node);
      }
    }
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["src"],
});

// Quét bổ sung trong 10s đầu để bắt các component render bất đồng bộ.
let ticks = 0;
const timer = setInterval(() => {
  scan();
  ticks += 1;
  if (ticks >= 20) clearInterval(timer);
}, 500);

window.addEventListener("load", () => scan(), { once: true });
