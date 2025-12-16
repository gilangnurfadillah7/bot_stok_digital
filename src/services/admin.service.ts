import { config } from '../config';
import { gasClient } from '../clients/gas.client';
import { AdminUser } from '../types';

class AdminService {
  async ensureActive(username?: string): Promise<AdminUser> {
    if (!username) throw new Error('User has no username set in Telegram');

    const normalized = username.toLowerCase();
    const ownerFallback: AdminUser | null =
      config.ownerUsername && normalized === config.ownerUsername.toLowerCase()
        ? {
            telegram_username: normalized,
            role: 'OWNER',
            status: 'ACTIVE',
          }
        : null;

    try {
      const admin = await gasClient.getAdminByUsername(normalized);
      if (admin.status !== 'ACTIVE') throw new Error('Admin not active');
      return admin;
    } catch (error) {
      if (ownerFallback) return ownerFallback;
      throw error;
    }
  }

  isOwner(admin: AdminUser) {
    return admin.role === 'OWNER';
  }
}

export const adminService = new AdminService();
