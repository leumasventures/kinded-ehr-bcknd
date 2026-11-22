import { conflict, notFound, wrap } from "../utils/errors.js";
import { audit } from "../services/audit.service.js";
import { createItem, getByCode, getItem, itemOut, listCategories, listItems, updateItem } from "../services/pricelist.service.js";

const label = (i) => `${i.code} (${i.name})`;

export const list = wrap(async (req, res) => {
  const { q, category, includeInactive } = req.query;
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  const items = await listItems({
    q: q ? String(q).slice(0, 80) : undefined,
    category: category ? String(category).slice(0, 60) : undefined,
    includeInactive: includeInactive === "1" || includeInactive === "true",
    limit,
  });
  res.json({ items });
});

export const categories = wrap(async (_req, res) => res.json({ categories: await listCategories() }));

export const get = wrap(async (req, res) => {
  const row = await getItem(req.params.id);
  if (!row) throw notFound("Price list item not found.");
  res.json({ item: itemOut(row) });
});

export const create = wrap(async (req, res) => {
  if (await getByCode(req.body.code.toUpperCase())) throw conflict("An item with this code already exists.");
  const row = await createItem(req.body);
  await audit(req, { action: "Create", module: "Price list", summary: `Added ${label(row)} in ${row.category} at ${Number(row.price).toFixed(2)}` });
  res.status(201).json({ item: itemOut(row) });
});

// Prices change going forward only: invoices keep the price they were issued with.
// There is no delete, because invoices point at these items. Switch an item off instead.
export const update = wrap(async (req, res) => {
  const row = await getItem(req.params.id);
  if (!row) throw notFound("Price list item not found.");
  const changed = await updateItem(row, req.body);
  if (changed.length) await audit(req, { action: "Update", module: "Price list", summary: `Updated ${label(row)}: ${changed.join(", ")}` });
  res.json({ item: itemOut(await getItem(row.id)) });
});