// Habilitations du back-office : chaque rôle donne un ensemble de permissions.
// Le rôle `user` correspond aux clients de l'API de paiement : pas d'accès
// au back-office.

const ROLE_PERMISSIONS = {
  admin: [
    'backoffice:access',
    'users:read',
    'users:write',
    'faces:manage',
    'locks:manage',
    'audit:read',
    'terminal:read',
    'payments:read',
    'payments:write'
  ],
  operator: [
    'backoffice:access',
    'terminal:read',
    'payments:read',
    'payments:write'
  ],
  auditor: [
    'backoffice:access',
    'users:read',
    'audit:read',
    'terminal:read',
    'payments:read'
  ],
  user: []
};

const ROLES = Object.keys(ROLE_PERMISSIONS);

const permissionsOf = (role) => ROLE_PERMISSIONS[role] || [];

const can = (role, permission) => permissionsOf(role).includes(permission);

module.exports = { ROLES, permissionsOf, can };
