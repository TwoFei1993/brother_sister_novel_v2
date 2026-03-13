"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const memoryStorage_1 = require("../storage/memoryStorage");
const fileStorage_1 = require("../storage/fileStorage");
const logger_1 = require("../utils/logger");
class CacheService {
    constructor(options = {}) {
        const { storageType = 'memory', ttl = 3600 * 1000, storageOptions = {} } = options;
        this.defaultTtl = ttl;
        // 根据类型选择存储后端
        switch (storageType) {
            case 'file':
                this.storage = new fileStorage_1.FileStorage(storageOptions);
                break;
            case 'memory':
                this.storage = new memoryStorage_1.MemoryStorage();
                break;
            case 'redis':
                // this.storage = new RedisStorage(storageOptions);
                throw new Error('Redis storage not implemented yet');
            default:
                throw new Error(`Unsupported storage type: ${storageType}`);
        }
    }
    // 生成 key
    generateKey(str) {
        return require('crypto').createHash('md5').update(str).digest('hex');
    }
    // 设置缓存
    async set(str, value, customTtl) {
        const key = this.generateKey(str);
        const ttl = customTtl ?? this.defaultTtl;
        logger_1.logger.debug(`CacheSerive Set cache: ${key}`);
        const item = {
            value,
            expireAt: Date.now() + ttl,
            // original: str,
        };
        return this.storage.set(key, item);
    }
    // 获取缓存
    async get(str) {
        try {
            const key = this.generateKey(str);
            const item = await this.storage.get(key);
            if (!item) {
                logger_1.logger.info(`no cache for:${key}`);
                return item;
            }
            if (item.expireAt < Date.now()) {
                await this.storage.delete(key); // 删除过期项
                return null;
            }
            logger_1.logger.debug(`CacheSerive hit cache: ${key}`);
            return item.value;
        }
        catch (err) {
            logger_1.logger.warn(`CacheSerive get cache error: ${err.message}`, { str });
            return null;
        }
    }
    // 检查是否存在
    async has(str) {
        const key = this.generateKey(str);
        const item = await this.storage.get(key);
        return !!(item && item.expireAt >= Date.now());
    }
    // 清理过期项
    async cleanExpired() {
        await this.storage.cleanExpired();
    }
}
exports.default = CacheService;
//# sourceMappingURL=cache.service.js.map