// Order DTOs for three audiences:
//   'public' - a guest holding the unguessable tracking id. No phone, email, street address or internal notes.
//   'owner'  - the customer who placed it.
//   'staff'  - kitchen, managers, riders: full detail.
import { firstName } from '../utils/format.js';

const iso = (d) => (d ? new Date(d).toISOString() : undefined);

function serializeItem(i) {
  return {
    menuItemId: i.menuItem ? String(i.menuItem) : undefined,
    slug: i.slug,
    name: i.name,
    art: i.art?.motif ? { motif: i.art.motif, palette: i.art.palette, seed: i.art.seed } : undefined,
    image: i.image || undefined,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    lineTotal: i.lineTotal,
    note: i.note || undefined,
    options: (i.options ?? []).map((o) => ({
      group: o.group,
      groupName: o.groupName,
      choice: o.choice,
      choiceName: o.choiceName,
      priceDelta: o.priceDelta ?? 0,
    })),
  };
}

export function serializeOrder(order, audience = 'public') {
  const o = typeof order.toObject === 'function' ? order.toObject() : order;
  const staff = audience === 'staff';
  const owner = audience === 'owner';
  const dto = {
    id: String(o._id),
    publicId: o.publicId,
    orderNumber: o.orderNumber,
    status: o.status,
    fulfillment: o.fulfillment,
    source: o.source,
    tableNumber: o.tableNumber || undefined,
    createdAt: iso(o.createdAt),
    placedAt: iso(o.placedAt),
    confirmedAt: iso(o.confirmedAt),
    preparingAt: iso(o.preparingAt),
    readyAt: iso(o.readyAt),
    deliveredAt: iso(o.deliveredAt),
    etaAt: iso(o.etaAt),
    scheduledFor: iso(o.scheduledFor),
    customerFirstName: firstName(o.customer?.name),
    items: (o.items ?? []).map(serializeItem),
    totals: o.totals,
    coupon: o.coupon?.code ? { code: o.coupon.code, discount: o.coupon.discount ?? 0 } : null,
    loyaltyRedeemed: { points: o.loyaltyRedeemed?.points ?? 0, value: o.loyaltyRedeemed?.value ?? 0 },
    payment: {
      method: o.payment?.method,
      status: o.payment?.status,
      provider: o.payment?.provider,
      paidAt: iso(o.payment?.paidAt),
      refundedTotal: o.payment?.refundedTotal ?? 0,
    },
    timeline: (o.statusHistory ?? []).map((h) => ({
      status: h.status,
      at: iso(h.at),
      ...(staff ? { by: h.by?.name ? { name: h.by.name, role: h.by.role } : undefined, note: h.note || undefined } : {}),
    })),
    cancellation: o.cancellation?.reason ? { reason: o.cancellation.reason, by: staff ? o.cancellation.by : undefined } : undefined,
    delivery: o.fulfillment === 'delivery' ? { area: o.address?.area, city: o.address?.city } : undefined,
  };
  if (owner || staff) {
    dto.customer = { name: o.customer?.name, phone: o.customer?.phone, email: o.customer?.email || undefined };
    dto.address = o.address && (o.address.line1 || o.address.area) ? { ...o.address } : undefined;
    dto.notes = o.notes || undefined;
    dto.userId = o.user ? String(o.user) : undefined;
  }
  if (staff) {
    dto.isDemo = Boolean(o.isDemo);
    dto.assignedDelivery = o.assignedDelivery ? { id: String(o.assignedDelivery._id ?? o.assignedDelivery), name: o.assignedDelivery.name } : undefined;
  }
  return dto;
}
