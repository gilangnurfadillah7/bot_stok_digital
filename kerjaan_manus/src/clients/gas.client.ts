import { FAKE_MODE } from '../config';

export const gasClient = {
    listActiveProducts: async () => ([{ product_id: 'P1', product_name: 'Product A', platform: 'Platform A', mode: 'private', duration_days: 30 }]),
    restockAccounts: async (data: any) => ({ accounts: data.accounts.map((a: any, i: number) => ({ account_id: `ACC${i}` })) }),
};
