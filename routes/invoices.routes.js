import { Router } from 'express';
import { Order } from '../models/index.js';
import { limiter } from '../middleware/rateLimit.js';
import { validate, z } from '../middleware/validate.js';
import { conflict, forbidden, notFound } from '../utils/errors.js';
import { can } from '../utils/permissions.js';
import { getRestaurant } from '../services/restaurantService.js';
import { INVOICE_STATUSES, buildInvoiceModel, renderInvoicePdf, samePhone } from '../services/invoiceService.js';

export const basePath = '/invoices';
const router = Router();

// Who may download an invoice: the signed-in guest who placed the order, staff who can see orders, or a guest who
// knows both the unguessable order link and the phone number on the order. The tracking page deliberately hides that phone.
router.get(
  '/:publicId',
  limiter({ windowMs: 10 * 60_000, limit: 30 }),
  validate({ params: z.object({ publicId: z.string().regex(/^[a-z0-9]{8,32}$/i) }), query: z.object({ phone: z.string().trim().max(24).optional() }) }),
  async (req, res) => {
    const order = await Order.findOne({ publicId: req.valid.params.publicId }).lean();
    if (!order) throw notFound('We could not find that order.');

    const isOwner = req.user && order.user && String(order.user) === String(req.user._id);
    const isStaff = req.user && can(req.user.role, 'orders:read');
    const knowsPhone = req.valid.query.phone && samePhone(req.valid.query.phone, order.customer?.phone);
    if (!isOwner && !isStaff && !knowsPhone) throw forbidden('Sign in, or enter the phone number used on the order, to download its invoice.', 'INVOICE_DENIED');
    if (!INVOICE_STATUSES.includes(order.status)) throw conflict('An invoice is available once the order has been accepted.', 'NO_INVOICE');

    const pdf = await renderInvoicePdf(buildInvoiceModel(order, await getRestaurant()));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="ELAN-${order.orderNumber}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  },
);

export default router;
