// Menu DTOs: the shapes the website and the dashboards receive. Never return raw documents.
const idOf = (value) => String(value && typeof value === 'object' && value._id ? value._id : value);
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const clean = (value) => (value === '' || value === null ? undefined : value);

export function serializeOptionGroup(g) {
  return {
    id: idOf(g),
    key: g.key,
    name: g.name,
    nameBn: clean(g.nameBn),
    helper: clean(g.helper),
    helperBn: clean(g.helperBn),
    isRequired: Boolean(g.isRequired),
    minSelect: g.minSelect ?? 0,
    maxSelect: g.maxSelect ?? 1,
    choices: (g.choices ?? []).map((c) => ({
      key: c.key,
      name: c.name,
      nameBn: clean(c.nameBn),
      priceDelta: c.priceDelta ?? 0,
      isDefault: Boolean(c.isDefault),
      available: c.available !== false,
    })),
  };
}

const activeGroups = (item) =>
  (Array.isArray(item.optionGroups) ? item.optionGroups : []).filter((g) => g && typeof g === 'object' && g.key && g.active !== false);

/** `item` is a lean document (or toObject()) with optionGroups and category populated when available. */
export function serializeMenuItem(item, { detail = false } = {}) {
  const groups = activeGroups(item);
  const cat = item.category && typeof item.category === 'object' && item.category.name ? item.category : null;
  const art = item.art && (item.art.motif || item.art.palette?.length) ? { motif: item.art.motif, palette: item.art.palette ?? undefined, seed: item.art.seed } : undefined;
  const dto = {
    id: String(item._id),
    slug: item.slug,
    name: item.name,
    nameBn: clean(item.nameBn),
    description: item.description,
    descriptionBn: clean(item.descriptionBn),
    category: cat ? { id: idOf(cat), name: cat.name, nameBn: clean(cat.nameBn), slug: cat.slug } : null,
    price: item.price,
    salePrice: item.salePrice ?? null,
    images: (item.images ?? []).map((i) => ({ url: i.url, alt: clean(i.alt), altBn: clean(i.altBn) })),
    art,
    tags: item.tags ?? [],
    allergens: item.allergens ?? [],
    spiceLevel: item.spiceLevel ?? 0,
    portion: clean(item.portion),
    portionBn: clean(item.portionBn),
    calories: item.calories ?? undefined,
    ingredients: item.ingredients ?? [],
    ingredientsBn: item.ingredientsBn?.length ? item.ingredientsBn : undefined,
    prepMinutes: item.prepMinutes ?? 15,
    available: Boolean(item.available) && !item.archived,
    featured: Boolean(item.featured),
    newArrival: Boolean(item.newArrival),
    rating: { avg: round1(item.rating?.avg), count: item.rating?.count ?? 0 },
    soldCount: item.soldCount ?? 0,
    quickAdd: !groups.some((g) => g.isRequired || (g.minSelect ?? 0) > 0),
  };
  if (detail) dto.optionGroups = groups.map(serializeOptionGroup);
  return dto;
}

/** Admin view: everything above plus the fields staff edit. */
export function serializeMenuItemAdmin(item) {
  const dto = serializeMenuItem({ ...item, archived: false }, { detail: true });
  return {
    ...dto,
    available: Boolean(item.available),
    archived: Boolean(item.archived),
    sku: clean(item.sku),
    sortOrder: item.sortOrder ?? 0,
    viewCount: item.viewCount ?? 0,
    optionGroupIds: (item.optionGroups ?? []).map(idOf),
    recipe: (item.recipe ?? []).map((r) => ({ ingredient: idOf(r.ingredient), name: r.ingredient?.name, quantity: r.quantity })),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function serializeCategory(category, itemCount = 0, fallbackArt) {
  const art = category.art?.motif ? { motif: category.art.motif, palette: category.art.palette ?? undefined } : fallbackArt;
  return {
    id: String(category._id),
    name: category.name,
    nameBn: clean(category.nameBn),
    slug: category.slug,
    description: clean(category.description),
    descriptionBn: clean(category.descriptionBn),
    sortOrder: category.sortOrder ?? 0,
    itemCount,
    art,
  };
}

export function serializeOffer(c) {
  return {
    id: String(c._id),
    code: c.code,
    headline: clean(c.headline),
    headlineBn: clean(c.headlineBn),
    description: clean(c.description),
    descriptionBn: clean(c.descriptionBn),
    terms: clean(c.terms),
    termsBn: clean(c.termsBn),
    type: c.type,
    value: c.value ?? 0,
    minOrder: c.minOrder ?? 0,
    expiresAt: c.expiresAt ?? null,
  };
}
