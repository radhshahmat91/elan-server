// User DTOs. Never include password hashes, lockout counters, other people's data or tokens.
const dayKey = (date) => (date ? new Date(date).toISOString().slice(0, 10) : undefined);

export function serializeUser(user) {
  const u = typeof user.toObject === 'function' ? user.toObject() : user;
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone || undefined,
    role: u.role,
    avatarUrl: u.avatarUrl || undefined,
    birthday: dayKey(u.birthday),
    marketingOptIn: Boolean(u.marketingOptIn),
    notificationPrefs: {
      orderUpdates: u.notificationPrefs?.orderUpdates !== false,
      reservationUpdates: u.notificationPrefs?.reservationUpdates !== false,
      promotions: Boolean(u.notificationPrefs?.promotions),
    },
    loyalty: { points: u.loyalty?.points ?? 0, lifetime: u.loyalty?.lifetime ?? 0, tier: u.loyalty?.tier ?? 'initie' },
    referralCode: u.referralCode || undefined,
    createdAt: u.createdAt,
  };
}

/** Staff and customer lists in the admin area. Includes status and activity, still no secrets. */
export function serializeUserAdmin(user, extra = {}) {
  const u = typeof user.toObject === 'function' ? user.toObject() : user;
  return {
    ...serializeUser(u),
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    isDemo: Boolean(u.isDemo),
    ...extra,
  };
}

export const serializeAddress = (a) => ({
  id: String(a._id),
  label: a.label,
  recipient: a.recipient || undefined,
  phone: a.phone || undefined,
  line1: a.line1,
  area: a.area,
  city: a.city,
  postcode: a.postcode || undefined,
  notes: a.notes || undefined,
  isDefault: Boolean(a.isDefault),
});
