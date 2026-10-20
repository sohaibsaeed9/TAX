// Manages the seen-notices registry in chrome.storage.local
// Tracks by client NTN to allow per-client resets

const NoticeStore = {
  _key(clientNtn) {
    return `notices_seen_${clientNtn.replace(/[^A-Z0-9]/gi, '')}`;
  },

  async getSeen(clientNtn) {
    const key = this._key(clientNtn);
    const data = await chrome.storage.local.get(key);
    return new Set(data[key] || []);
  },

  async markSeen(clientNtn, noticeId) {
    const key = this._key(clientNtn);
    const seen = await this.getSeen(clientNtn);
    seen.add(noticeId);
    await chrome.storage.local.set({ [key]: Array.from(seen) });
  },

  async isNew(clientNtn, noticeId) {
    const seen = await this.getSeen(clientNtn);
    return !seen.has(noticeId);
  },

  async clearClient(clientNtn) {
    await chrome.storage.local.remove(this._key(clientNtn));
  },

  async clearAll() {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith('notices_seen_'));
    await chrome.storage.local.remove(keys);
  },

  async getStats() {
    const all = await chrome.storage.local.get(null);
    const stats = {};
    for (const [key, val] of Object.entries(all)) {
      if (key.startsWith('notices_seen_')) {
        const ntn = key.replace('notices_seen_', '');
        stats[ntn] = Array.isArray(val) ? val.length : 0;
      }
    }
    return stats;
  }
};
