import { FAKE_MODE } from '../config';

export const adminService = {
    ensureActive: async (username?: string) => {
        if (FAKE_MODE) {
            return { telegram_username: username || 'test_admin', is_owner: username === 'admin_a' };
        }
        // Real implementation...
        return { telegram_username: username || 'test_admin', is_owner: username === 'admin_a' };
    },
    isOwner: (admin: any) => admin.is_owner,
};
