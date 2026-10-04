// localStorage access that never throws (private mode, blocked storage, full quota).

const PREFIX = 'topochamp.';

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not fatal: the game keeps working, it just won't remember this.
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

export const newId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
