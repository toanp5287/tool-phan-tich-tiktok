/**
 * Sinh slug ASCII từ tên tiếng Việt (dùng cho Category/SubCategory).
 * VD: "Mỹ phẩm & Làm đẹp" -> "my-pham-lam-dep"
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'category';
}

export function uniqueSlug(base: string, used: Set<string>): string {
  const root = slugify(base);
  if (!used.has(root)) {
    used.add(root);
    return root;
  }

  let index = 2;
  while (used.has(`${root}-${index}`)) index += 1;
  const next = `${root}-${index}`;
  used.add(next);
  return next;
}
