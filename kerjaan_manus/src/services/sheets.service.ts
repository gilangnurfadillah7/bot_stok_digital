import { FAKE_MODE } from '../config';

const existingAccounts = new Set(['existing_acc@test.com']);

export const sheetsService = {
    listRecentActiveOrders: async (limit: number) => ([{ order_id: 'O1', seat_id: 'S1', product_id: 'P1', buyer_id: 'buyer1' }]),
    listAccountIdentities: async (platform: string) => {
        if (FAKE_MODE) {
            // Simulate race condition by adding the account from Admin A's confirm to the existing set
            if (platform === 'Platform A' && existingAccounts.has('acc_race@test.com')) {
                return new Set([...existingAccounts, 'acc_race@test.com']);
            }
        }
        return existingAccounts;
    },
    // Mock function to simulate the write operation adding the account
    addAccountIdentity: (account: string) => {
        existingAccounts.add(account);
    }
};
