/** Client API tối giản cho module /api/commerce. */

const BASE = "/api";

async function request(path, params = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    throw new Error(body?.error?.message ?? `Yêu cầu thất bại (${response.status})`);
  }

  return body;
}

export const api = {
  demoProducts: () => request('/demo-products'),
  productIntelligence: (id) => request(`/products/${id}/intelligence`),
  overview: (range) => request("/overview", { range }),
  products: (params) => request("/products", params),
  product: (id, range, mode) => request(`/products/${id}`, { range, mode }),
  productCreators: (id, params) => request(`/products/${id}/creators`, params),
  productVideos: (id, params) => request(`/products/${id}/videos`, params),
  shops: (params) => request("/shops", params),
  shop: (id, range) => request(`/shops/${id}`, { range }),
  shopProducts: (id, params) => request(`/shops/${id}/products`, params),
  shopCreators: (id, params) => request(`/shops/${id}/creators`, params),
  creators: (params) => request("/creators", params),
  creator: (id, range) => request(`/creators/${id}`, { range }),
  creatorProducts: (id, params) => request(`/creators/${id}/products`, params),
  creatorShops: (id, params) => request(`/creators/${id}/shops`, params),
  categories: (range) => request("/categories", { range }),
  category: (name, range) => request(`/categories/${encodeURIComponent(name)}`, { range }),
  trendVideos: (limit = 12) => request("/trend-videos", { limit }),
};

const TREND_BASE = "/api/trend-analysis";

async function trendRequest(path, params = {}) {
  const url = new URL(`${TREND_BASE}${path}`, window.location.origin);
  params = { anchor: "latest", ...params };
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    throw new Error(body?.error?.message ?? `Yêu cầu thất bại (${response.status})`);
  }

  return body;
}

/** API xu hướng dựa trên mốc snapshot lịch sử (bucketDate). */
export const trendApi = {
  overview: (days, periods, range) => trendRequest("/overview", { days, periods, range }),
  comparison: (days, periods, categories, range) =>
    trendRequest("/comparison", {
      days,
      periods,
      categories: categories?.length ? categories.join(",") : undefined,
      range,
    }),
  category: (name, days, periods, range) =>
    trendRequest(`/category/${encodeURIComponent(name)}`, { days, periods, range }),
  periods: (days, periods, range) => trendRequest("/periods", { days, periods, range }),
};
