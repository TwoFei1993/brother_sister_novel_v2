"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
const cache_service_1 = __importDefault(require("./cache.service"));
class AudioCacheService {
    constructor({ storageType, ttl, storageOptions }) {
        if (!storageOptions?.cacheDir)
            throw new Error(`AudioCacheService cacheDir needed!`);
        logger_1.logger.info(`init AudioCacheService with`, { storageType, ttl, storageOptions });
        this.cache = new cache_service_1.default({
            storageType,
            ttl,
            storageOptions,
        });
    }
    async setAudio(str, audioData) {
        return this.cache.set(str, audioData);
    }
    async getAudio(str) {
        return this.cache.get(str);
    }
    async hasAudio(str) {
        return this.cache.has(str);
    }
    async cleanExpired() {
        return this.cache.cleanExpired();
    }
}
const instance = new AudioCacheService({
    storageType: 'file',
    ttl: 365 * 24 * 60 * 60 * 1e3,
    storageOptions: { cacheDir: config_1.AUDIO_CACHE_DIR },
});
exports.default = instance;
//# sourceMappingURL=audioCache.service.js.map