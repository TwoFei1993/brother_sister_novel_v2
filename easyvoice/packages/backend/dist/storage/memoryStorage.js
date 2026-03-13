"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryStorage = void 0;
// services/cache/storage/memoryStorage.ts
const baseStorage_1 = require("./baseStorage");
class MemoryStorage extends baseStorage_1.BaseStorage {
    constructor() {
        super();
        this.cache = new Map();
    }
    async set(key, value) {
        this.cache.set(key, value);
        return true;
    }
    async get(key) {
        return this.cache.get(key) || null;
    }
    async delete(key) {
        this.cache.delete(key);
    }
    async cleanExpired() {
        const now = Date.now();
        for (const [key, item] of this.cache) {
            if (item.expireAt < now) {
                this.cache.delete(key);
            }
        }
    }
}
exports.MemoryStorage = MemoryStorage;
//# sourceMappingURL=memoryStorage.js.map