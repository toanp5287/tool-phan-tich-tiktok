/* ==========================================================================
   Shared App Shell — unified sidebar + header for ALL standalone pages.
   Injected by shared.js mountApp() (and market-workspace.js, jobs.js, targets.js,
   price-segments.js, trend-analysis.js) so every page shares ONE navigation system.

   Features:
   - Plain <a href> navigation (full page load) => deep-links, F5, Back/Forward work.
   - Collapsible groups (TỔNG QUAN / PHÂN TÍCH / DỮ LIỆU / HỆ THỐNG).
   - Icon-only collapse mode with tooltips (persisted in localStorage).
   - Active item resolved from the current pathname (+ SPA `view` query).
   ========================================================================== */

import { icon } from "./icons.js";

const GROUPS = {
  overview: "Tổng quan",
  analysis: "Phân tích",
  data: "Dữ liệu",
  system: "Hệ thống",
};

const GROUP_ORDER = ["overview", "analysis", "data", "system"];

const ROUTES = [
  { group: "overview", label: "Dashboard", icon: "dashboard", href: "/shop.html", match: ["/shop.html"] },

  { group: "analysis", label: "Sản phẩm", icon: "box", href: "/app/?view=products", match: ["/detail.html", "/ai-analysis.html"] },
  { group: "analysis", label: "Cửa hàng", icon: "store", href: "/shops.html", match: ["/shops.html", "/shop-detail.html"] },
  { group: "analysis", label: "Thị trường", icon: "target", href: "/market-intelligence.html", match: ["/market-intelligence.html"] },
  { group: "analysis", label: "Creator/Affiliate", icon: "users", href: "/creators.html", match: ["/creators.html", "/creator.html"] },

  { group: "data", label: "Danh mục", icon: "tag", href: "/categories.html", match: ["/categories.html", "/category.html", "/subcategory.html"] },
  { group: "data", label: "Phân khúc giá", icon: "coin", href: "/price-segments.html", match: ["/price-segments.html"] },
  { group: "data", label: "Xu hướng ngành", icon: "trendingUp", href: "/trend-analysis.html", match: ["/trend-analysis.html"] },
  { group: "data", label: "Xu hướng", icon: "activity", href: "/trends.html", match: ["/trends.html"] },

  { group: "system", label: "Tiến trình dữ liệu", icon: "history", href: "/jobs.html", match: ["/jobs.html"] },
  { group: "system", label: "Shop mục tiêu", icon: "flag", href: "/targets.html", match: ["/targets.html"] },
];

function isActive(route) {
  return route.match.includes(window.location.pathname);
}

function buildSidebar(collapsedGroups) {
  const byGroup = {};
  for (const route of ROUTES) (byGroup[route.group] ??= []).push(route);

  let items = "";
  for (const group of GROUP_ORDER) {
    const routes = byGroup[group] ?? [];
    if (!routes.length) continue;
    const isCollapsed = collapsedGroups.has(group);
    items += `<div class="nav-group${isCollapsed ? " is-collapsed" : ""}" data-group="${group}">
      <button type="button" class="nav-group-label" aria-expanded="${!isCollapsed}">
        <span>${GROUPS[group]}</span>
        <span class="nav-group-chevron" aria-hidden="true">${icon("chevronDown")}</span>
      </button>`;
    for (const route of routes) {
      const active = isActive(route);
      items += `<a class="nav-item${active ? " is-active" : ""}" href="${route.href}" data-tooltip="${route.label}" aria-current="${active ? "page" : "false"}">
        <span class="nav-item-icon" aria-hidden="true">${icon(route.icon)}</span>
        <span class="nav-item-label">${route.label}</span>
      </a>`;
    }
    items += `</div>`;
  }

  return `<aside class="shared-sidebar" id="shared-sidebar">
    <div class="sidebar-brand">
      <a class="sidebar-brand-link" href="/shop.html">
        <span class="brand-mark">TS</span>
        <span class="sidebar-brand-text"><span class="brand-title">TikTok Analytics</span><span class="brand-sub">Commerce Intelligence</span></span>
      </a>
    </div>
    <nav class="sidebar-nav" aria-label="Điều hướng chính">${items}</nav>
    <div class="sidebar-foot">
      <button type="button" class="nav-item sidebar-collapse" aria-label="Thu gọn menu" aria-pressed="false">
        <span class="nav-item-icon" aria-hidden="true">${icon("chevronsLeft")}</span>
        <span class="nav-item-label">Thu gọn</span>
      </button>
    </div>
    <div class="sidebar-mobile-close" role="button" tabindex="0">Đóng menu</div>
  </aside>`;
}

function readCollapsedGroups() {
  try {
    const raw = JSON.parse(localStorage.getItem("ts-sidebar-groups") || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x) => x in GROUPS) : []);
  } catch {
    return new Set();
  }
}

function initShell(sidebar) {
  const collapsedGroups = readCollapsedGroups();

  sidebar.querySelectorAll(".nav-group-label").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (sidebar.classList.contains("is-collapsed")) return;
      const group = btn.closest(".nav-group");
      group.classList.toggle("is-collapsed");
      const open = !group.classList.contains("is-collapsed");
      btn.setAttribute("aria-expanded", String(open));
      const set = readCollapsedGroups();
      if (open) set.delete(group.dataset.group);
      else set.add(group.dataset.group);
      localStorage.setItem("ts-sidebar-groups", JSON.stringify([...set]));
    });
  });

  const collapseBtn = sidebar.querySelector(".sidebar-collapse");
  const applyCollapse = (collapsed) => {
    sidebar.classList.toggle("is-collapsed", collapsed);
    collapseBtn.setAttribute("aria-pressed", String(collapsed));
    collapseBtn.setAttribute("aria-label", collapsed ? "Mở rộng menu" : "Thu gọn menu");
    collapseBtn.setAttribute("data-tooltip", collapsed ? "Mở rộng" : "Thu gọn");
    collapseBtn.querySelector(".nav-item-icon").innerHTML = icon(collapsed ? "chevronsRight" : "chevronsLeft");
  };

  let collapsed = false;
  try { collapsed = localStorage.getItem("ts-sidebar-collapsed") === "1"; } catch {}
  applyCollapse(collapsed);

  collapseBtn.addEventListener("click", () => {
    collapsed = !collapsed;
    try { localStorage.setItem("ts-sidebar-collapsed", collapsed ? "1" : "0"); } catch {}
    applyCollapse(collapsed);
  });

  initTooltip(sidebar);
  initMobile(sidebar);
}

function initTooltip(sidebar) {
  const tip = document.createElement("div");
  tip.className = "shell-tooltip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);

  const show = (item) => {
    if (!sidebar.classList.contains("is-collapsed")) return;
    const label = item.getAttribute("data-tooltip");
    if (!label) return;
    tip.textContent = label;
    tip.style.display = "block";
    const rect = item.getBoundingClientRect();
    tip.style.left = `${rect.right + 10}px`;
    tip.style.top = `${rect.top + rect.height / 2}px`;
  };
  const hide = () => { tip.style.display = "none"; };

  sidebar.addEventListener("mouseover", (e) => {
    const item = e.target.closest(".nav-item");
    if (item) show(item);
  });
  sidebar.addEventListener("mouseout", (e) => {
    if (e.target.closest(".nav-item")) hide();
  });
  sidebar.addEventListener("focusin", (e) => {
    const item = e.target.closest(".nav-item");
    if (item) show(item);
  });
  sidebar.addEventListener("focusout", (e) => {
    if (e.target.closest(".nav-item")) hide();
  });
}

function initMobile(sidebar) {
  const closeBtn = sidebar.querySelector(".sidebar-mobile-close");
  const close = () => sidebar.classList.remove("is-open");
  if (closeBtn) {
    closeBtn.addEventListener("click", close);
    closeBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); close(); }
    });
  }
}

export function injectShell(container) {
  if (document.querySelector(".shared-sidebar")) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildSidebar(readCollapsedGroups());
  const sidebar = wrapper.querySelector(".shared-sidebar");
  container.parentNode.insertBefore(sidebar, container);
  initShell(sidebar);

  // Mobile open button lives at body level (outside #app) so Vue re-render never removes it.
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "shell-menu-toggle";
  toggle.setAttribute("aria-label", "Mở menu");
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';
  toggle.onclick = () => sidebar.classList.add("is-open");
  document.body.appendChild(toggle);
}
