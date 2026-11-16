import { formatCurrency, formatNumber, formatPercent, growthMeta, initials, analyticsSummary, dataKindClass } from "./format.js";
import { resolveImage, fallbackFor, bannerStyle } from "./images.js";

/* Map legacy emoji icon props to unified SVG glyphs (no emoji in UI). */
const ICONS = {
  "₫": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 8.5h6M9 11.5h4a2 2 0 0 1 0 4H9z"/></svg>',
  "◫": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
  "↗": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/></svg>',
  "⌀": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 9.09 8.26 2 9.27l5 4.87-1.18 6.88L12 17.77l6.18 3.25L17 14.14l5-4.87-7.09-1.01Z"/></svg>',
  "⌂": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9 4 3h16l1 6"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 11v8h14v-8"/><path d="M9 19v-6h6v6"/></svg>',
  "☺": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  "◎": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
};

function statIcon(glyph) {
  return ICONS[glyph] ?? ICONS["◫"];
}

/** Badge mũi tên xanh/đỏ cho Delta GMV & tăng trưởng. */
export const GrowthBadge = {
  name: "GrowthBadge",
  props: {
    metric: { type: Object, required: true },
    mode: { type: String, default: "rate" }, // rate | delta
  },
  computed: {
    meta() {
      return growthMeta(this.metric);
    },
    text() {
      if (!this.metric) return "—";
      if (!this.metric.hasBaseline) return this.meta.label;
      return this.mode === "delta" ? `Δ ${this.meta.gmvDelta}` : this.meta.rate;
    },
    title() {
      if (!this.metric) return "";
      if (!this.metric.hasBaseline) return "Chưa đủ dữ liệu kỳ trước để so sánh";
      return `${this.meta.label} · ${formatPercent(this.metric.growthRate, true)} · ΔGMV ${formatCurrency(
        this.metric.delta,
      )}`;
    },
  },
  template: `
    <span class="growth" :class="meta.direction" :title="title">
      <span class="growth-arrow" aria-hidden="true">{{ meta.arrow }}</span>
      <span>{{ text }}</span>
    </span>
  `,
};

/** Nhãn nguồn gốc dữ liệu: VERIFIED / ESTIMATED / SIMULATED / UNKNOWN. */
export const DataKindBadge = {
  name: "DataKindBadge",
  props: {
    kind: { type: String, default: "UNKNOWN" },
    state: { type: String, default: "" },
  },
  computed: {
    summary() {
      return analyticsSummary({ dataKind: this.kind, state: this.state });
    },
    title() {
      return this.state ? `${this.summary.label} · ${this.summary.stateLabel}` : this.summary.label;
    },
  },
  methods: { dataKindClass },
  template: `
    <span class="data-kind" :class="dataKindClass(kind)" :title="title">{{ summary.label }}</span>
  `,
};

/** Thẻ số liệu lớn với delta GMV và badge tăng trưởng. */
export const StatCard = {
  name: "StatCard",
  components: { GrowthBadge, DataKindBadge },
  props: {
    label: { type: String, required: true },
    value: { type: [String, Number], required: true },
    metric: { type: Object, default: null },
    hint: { type: String, default: "" },
    icon: { type: String, default: "" },
    kind: { type: String, default: "" },
    state: { type: String, default: "" },
  },
  template: `
    <div class="stat">
      <div class="stat-label">
        <span v-if="icon" class="stat-icon" aria-hidden="true" v-html="statIcon(icon)"></span>
        <span>{{ label }}</span>
        <data-kind-badge v-if="kind" :kind="kind" :state="state" />
      </div>
      <div class="stat-value">{{ value }}</div>
      <div class="stat-foot">
        <growth-badge v-if="metric" :metric="metric" mode="rate" />
        <span v-if="metric && metric.hasBaseline" class="stat-hint">Δ {{ formatCurrency(metric.delta, true) }}</span>
        <span v-else-if="hint" class="stat-hint">{{ hint }}</span>
      </div>
    </div>
  `,
  methods: { formatCurrency, statIcon },
};

/** Bộ lọc thời gian toàn cục. */
export const TimeFilter = {
  name: "TimeFilter",
  props: {
    modelValue: { type: String, default: "30d" },
    ranges: { type: Array, default: () => [] },
  },
  emits: ["update:modelValue"],
  template: `
    <div class="segmented" role="group" aria-label="Bộ lọc thời gian">
      <button
        v-for="option in ranges"
        :key="option.key"
        type="button"
        :class="{ 'is-active': modelValue === option.key }"
        :aria-pressed="modelValue === option.key"
        :title="option.label"
        @click="$emit('update:modelValue', option.key)"
      >{{ option.short }}</button>
    </div>
  `,
};

/** Trạng thái tải / lỗi / rỗng. */
export const StateBlock = {
  name: "StateBlock",
  props: {
    loading: { type: Boolean, default: false },
    error: { type: String, default: "" },
    empty: { type: Boolean, default: false },
    emptyText: { type: String, default: "Chưa có dữ liệu" },
  },
  template: `
    <div v-if="loading" class="card card-pad" style="display:grid;gap:10px">
      <div class="skeleton" style="height:14px;width:40%"></div>
      <div class="skeleton" style="height:12px;width:70%"></div>
      <div class="skeleton" style="height:120px;width:100%"></div>
    </div>
    <div v-else-if="error" class="alert">{{ error }}</div>
    <div v-else-if="empty" class="card empty">{{ emptyText }}</div>
    <slot v-else />
  `,
};

export const SectionCard = {
  name: "SectionCard",
  components: { DataKindBadge },
  props: {
    title: { type: String, required: true },
    subtitle: { type: String, default: "" },
    kind: { type: String, default: "" },
    state: { type: String, default: "" },
  },
  template: `
    <section class="card">
      <header class="card-head">
        <div>
          <div class="card-title-row"><h2 class="card-title">{{ title }}</h2><data-kind-badge v-if="kind" :kind="kind" :state="state" /></div>
          <p v-if="subtitle" class="card-sub">{{ subtitle }}</p>
        </div>
        <slot name="actions" />
      </header>
      <div class="card-body">
        <slot />
      </div>
    </section>
  `,
};

/**
 * Avatar có fallback chữ cái gradient qua ui-avatars.com.
 * Không bao giờ để khung ảnh bị vỡ trống.
 */
export const Avatar = {
  name: "Avatar",
  props: {
    src: { type: String, default: "" },
    name: { type: String, default: "" },
  },
  data() {
    return { imageFailed: false };
  },
  watch: {
    src() {
      this.imageFailed = false;
    },
  },
  computed: {
    fallback() {
      return initials(this.name || "?");
    },
    imageSrc() {
      if (this.imageFailed) return fallbackFor(this.name, "avatar");
      return resolveImage(this.src, this.name, "avatar");
    },
  },
  template: `
    <img
      :src="imageSrc"
      :alt="name"
      class="avatar"
      loading="lazy"
      referrerpolicy="no-referrer"
      @error="imageFailed = true"
    />
  `,
};

/** Ảnh sản phẩm với fallback placeholder thương mại điện tử. */
export const ProductImage = {
  name: "ProductImage",
  props: {
    src: { type: String, default: "" },
    name: { type: String, default: "" },
    alt: { type: String, default: "" },
    className: { type: String, default: "thumb" },
  },
  data() {
    return { imageFailed: false };
  },
  watch: {
    src() {
      this.imageFailed = false;
    },
  },
  computed: {
    imageSrc() {
      if (this.imageFailed) return fallbackFor(this.name, "product");
      return resolveImage(this.src, this.name, "product");
    },
  },
  template: `
    <img
      :src="imageSrc"
      :alt="alt || name"
      :class="className"
      loading="lazy"
      referrerpolicy="no-referrer"
      @error="imageFailed = true"
    />
  `,
};

/** Banner shop với ảnh nền fallback gradient (preload để phát hiện ảnh lỗi). */
export const ShopBanner = {
  name: "ShopBanner",
  props: {
    src: { type: String, default: "" },
    name: { type: String, default: "" },
    label: { type: String, default: "TikTok Shop VN" },
  },
  data() {
    return { imageFailed: false };
  },
  watch: {
    src: {
      immediate: true,
      handler(value) {
        this.imageFailed = false;
        if (!value) return;
        const probe = new Image();
        probe.onerror = () => {
          this.imageFailed = true;
        };
        probe.src = value;
      },
    },
  },
  computed: {
    style() {
      if (this.imageFailed || !this.src) return bannerStyle("", this.name);
      return bannerStyle(this.src, this.name);
    },
    showFallbackLabel() {
      return !this.src || this.imageFailed;
    },
  },
  template: `
    <div class="shop-banner" :style="style">
      <span v-if="showFallbackLabel" class="shop-banner-fallback">{{ label }}</span>
    </div>
  `,
};

export const Formatters = {
  formatCurrency,
  formatNumber,
  formatPercent,
};
