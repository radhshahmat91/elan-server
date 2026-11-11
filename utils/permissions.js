// Role-based access control. The backend is the source of truth: routes call requirePermission()
// (see middleware/auth.js); hiding buttons in the UI is only a convenience.
//
// Permission names are 'resource:action'. '*' grants everything, 'resource:*' grants a whole resource.

export const ROLE_PERMISSIONS = Object.freeze({
  owner: ['*'],
  manager: [
    'orders:read', 'orders:update', 'orders:assign', 'payments:refund',
    'menu:*', 'reservations:*', 'tables:*', 'customers:read', 'customers:update', 'loyalty:adjust',
    'inventory:*', 'coupons:*', 'reviews:moderate', 'analytics:read', 'content:*', 'messages:*',
    'staff:read', 'audit:read', 'settings:read', 'kitchen:view', 'uploads:create',
  ],
  chef: [
    'kitchen:view', 'orders:read', 'orders:progress', 'menu:availability', 'inventory:read', 'inventory:adjust',
  ],
  delivery: ['deliveries:read', 'deliveries:update', 'orders:read:assigned'],
  customer: [],
});

export const STAFF_ROLES = Object.freeze(['delivery', 'chef', 'manager', 'owner']);
export const ROLES = Object.freeze(['customer', ...STAFF_ROLES]);

export function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(role, permission) {
  const granted = permissionsFor(role);
  if (granted.includes('*') || granted.includes(permission)) return true;
  const [resource] = permission.split(':');
  return granted.includes(`${resource}:*`);
}

export const isStaff = (role) => STAFF_ROLES.includes(role);
