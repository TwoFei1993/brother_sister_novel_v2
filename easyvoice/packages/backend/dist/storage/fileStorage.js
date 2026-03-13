"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileStorage = void 0;
// services/cache/storage/fileStorage.ts
const baseStorage_1 = require("./baseStorage");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
class FileStorage extends baseStorage_1.BaseStorage {
    constructor(options) {
        super();
        this.cacheDir = options.cacheDir;
        this.initDir();
    }
    async initDir() {
        await fs.mkdir(this.cacheDir, { recursive: true });
    }
    getFilePath(key) {
        return path.join(this.cacheDir, `${key}.json`);
    }
    async set(key, value) {
        const filePath = this.getFilePath(key);
        await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
        return true;
    }
    async get(key) {
        const filePath = this.getFilePath(key);
        try {
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        }
        catch (err) {
            if (err.code === 'ENOENT')
                return null;
            throw err;
        }
    }
    async delete(key) {
        const filePath = this.getFilePath(key);
        await fs.unlink(filePath);
    }
    async cleanExpired() {
        const files = await fs.readdir(this.cacheDir);
        const now = Date.now();
        for (const file of files) {
            const filePath = path.join(this.cacheDir, file);
            const data = await fs.readFile(filePath, 'utf8');
            const item = JSON.parse(data);
            if (item?.expireAt < now) {
                await fs.unlink(filePath);
            }
        }
    }
}
exports.FileStorage = FileStorage;
//# sourceMappingURL=fileStorage.js.map