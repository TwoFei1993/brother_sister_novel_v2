"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ttsPluginManager = exports.TtsPluginManager = void 0;
class TtsPluginManager {
    constructor() {
        this.engines = new Map();
    }
    registerEngine(engine) {
        this.engines.set(engine.name, engine);
    }
    async initializeEngines() {
        for (const engine of this.engines.values()) {
            if (engine.initialize) {
                try {
                    await engine.initialize();
                }
                catch (error) {
                    console.error(`Failed to initialize engine ${engine.name}:`, error);
                    this.engines.has(engine.name) && this.engines.delete(engine.name);
                }
            }
        }
    }
    getEngine(name) {
        return this.engines.get(name);
    }
    getAllEngines() {
        return Array.from(this.engines.values());
    }
}
exports.TtsPluginManager = TtsPluginManager;
exports.ttsPluginManager = new TtsPluginManager();
//# sourceMappingURL=pluginManager.js.map