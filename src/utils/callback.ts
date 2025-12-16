export const encodeCallbackData = (action: string, payload: Record<string, string> = {}) => {
  const entries = Object.entries(payload)
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
  const raw = entries ? `${action}|${entries}` : action;
  if (raw.length > 64) {
    throw new Error('Callback data too long');
  }
  return raw;
};

export const decodeCallbackData = (
  data: string
): { action: string; payload: Record<string, string> } => {
  const [action, ...rest] = data.split('|');
  const payload = rest.reduce<Record<string, string>>((acc, item) => {
    const [k, ...v] = item.split(':');
    acc[k] = v.join(':');
    return acc;
  }, {});
  return { action, payload };
};
