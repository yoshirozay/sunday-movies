"use client";

// Client-only watchlist storage. Per-device (no auth, no sync) — keeps the
// feature trivial. Just an array of tconst IDs in localStorage. When we
// eventually add accounts, this list is the most natural thing to migrate.

const KEY = "watchlist";

type Listener = (ids: string[]) => void;
const listeners = new Set<Listener>();

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(ids));
  listeners.forEach((fn) => fn(ids));
}

export function getList(): string[] {
  return read();
}

export function has(id: string): boolean {
  return read().includes(id);
}

// Returns the new "is saved" state.
export function toggle(id: string): boolean {
  const current = read();
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : [...current, id];
  write(next);
  return next.includes(id);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  // Cross-tab sync: if another tab updates the watchlist, react to it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) fn(read());
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(fn);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}
