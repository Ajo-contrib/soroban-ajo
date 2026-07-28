import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type AdminRole = 'super_admin' | 'moderator' | 'support_agent';

export interface AdminUser {
  id: string;
  email: string;
  role: AdminRole;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminUser;
    }
  }
}

const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
  super_admin: [
    'users:read', 'users:write', 'users:delete', 'users:suspend',
    'groups:read', 'groups:write', 'groups:delete',
    'transactions:read',
    'moderation:read', 'moderation:write',
    'config:read', 'config:write',
    'audit:read',
    'reports:read',
    'admins:manage',
  ],
  moderator: [
    'users:read', 'users:suspend',
    'groups:read', 'groups:delete',
    'transactions:read',
    'moderation:read', 'moderation:write',
    'audit:read',
    'reports:read',
  ],
  support_agent: [
    'users:read',
    'groups:read',
    'transactions:read',
    'moderation:read',
    'reports:read',
  ],
};

/**
 * Verifies an admin JWT and returns the resolved AdminUser (with permissions).
 * Shared by the Express `adminAuth` middleware and the GraphQL context builder
 * so both API surfaces enforce identical admin authorization.
 *
 * @throws if the token is missing, expired, invalid, or not an admin token.
 */
export function verifyAdminToken(token: string): AdminUser {
  const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET!;

  const decoded = jwt.verify(token, secret) as {
    id: string;
    email: string;
    role: AdminRole;
    isAdmin: boolean;
  };

  if (!decoded.isAdmin) {
    throw new Error('Not an admin account');
  }

  return {
    id: decoded.id,
    email: decoded.email,
    role: decoded.role,
    permissions: ROLE_PERMISSIONS[decoded.role] || [],
  };
}

export function adminAuth(requiredPermission?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing admin token' });
      }

      const token = authHeader.split(' ')[1];
      const admin = verifyAdminToken(token);
      req.admin = admin;

      if (requiredPermission && !admin.permissions.includes(requiredPermission)) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          required: requiredPermission,
        });
      }

      next();
    } catch (err) {
      if (err instanceof Error && err.message === 'Not an admin account') {
        return res.status(403).json({ error: err.message });
      }
      return res.status(401).json({ error: 'Invalid or expired admin token' });
    }
  };
}

export function requirePermission(permission: string) {
  return adminAuth(permission);
}
