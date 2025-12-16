import { FAKE_MODE } from '../config';

export const reportService = {
    stockSummary: async () => {
        if (FAKE_MODE) {
            throw new Error('Gagal koneksi ke Google Sheets API.');
        }
        return { text: 'Mock Stock Report' };
    },
    salesSummary: async () => ({ text: 'Mock Sales Report' }),
};
