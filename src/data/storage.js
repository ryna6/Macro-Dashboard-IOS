// src/data/storage.js
export const storage = {
  // Preferred explicit JSON helpers
  getJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  },

  setJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  },

  // Backwards-compatible aliases (so code can call storage.get / storage.set)
  get(key) {
    return this.getJSON(key);
  },

  set(key, value) {
    this.setJSON(key, value);
  },

  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }
};
