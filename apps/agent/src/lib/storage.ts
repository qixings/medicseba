import AsyncStorage from '@react-native-async-storage/async-storage';

/** Device storage for the login, cached boards and actions waiting to sync. Works on phones and web. */
export const storage = {
  get: (k: string) => AsyncStorage.getItem(k).catch(() => null),
  set: (k: string, v: string) => AsyncStorage.setItem(k, v).catch(() => {}),
  remove: (k: string) => AsyncStorage.removeItem(k).catch(() => {}),
  async getJSON<T>(k: string): Promise<T | null> {
    const v = await this.get(k);
    if (!v) return null;
    try { return JSON.parse(v) as T; } catch { return null; }
  },
  setJSON: (k: string, v: unknown) => AsyncStorage.setItem(k, JSON.stringify(v)).catch(() => {}),
};
