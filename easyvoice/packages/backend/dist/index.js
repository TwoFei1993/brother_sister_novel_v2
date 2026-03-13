"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main_handler = main_handler;
const app_1 = require("./app");
const config_1 = require("./config");
const pluginManager_1 = require("./tts/pluginManager");
let app;
/**
 * 初始化应用
 */
async function init() {
    if (!app) {
        app = (0, app_1.createApp)({
            isDev: process.env.NODE_ENV === 'development',
            rateLimit: config_1.RATE_LIMIT,
            rateLimitWindow: config_1.RATE_LIMIT_WINDOW,
            audioDir: config_1.AUDIO_DIR,
            publicDir: config_1.PUBLIC_DIR,
        });
        await pluginManager_1.ttsPluginManager.initializeEngines();
    }
    return app;
}
/**
 * 云函数入口 - SCF 会调用这个函数
 */
async function main_handler(event, context) {
    // 等待应用初始化
    const expressApp = await init();
    // 返回 Express app 用于 SCF
    return expressApp(event, context);
}
//# sourceMappingURL=index.js.map