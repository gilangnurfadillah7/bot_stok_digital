export const encodeCallbackData = (action: string, payload: any = {}) => {
    return JSON.stringify({ a: action, p: payload });
};

export const decodeCallbackData = (data: string) => {
    try {
        const { a: action, p: payload } = JSON.parse(data);
        return { action, payload };
    } catch (e) {
        return { action: 'HOME', payload: {} };
    }
};
