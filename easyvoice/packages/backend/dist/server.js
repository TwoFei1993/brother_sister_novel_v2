"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const config_1 = require("./config");
const pluginManager_1 = require("./tts/pluginManager");
const app = (0, app_1.createApp)({
    isDev: process.env.NODE_ENV === 'development',
    rateLimit: config_1.RATE_LIMIT,
    rateLimitWindow: config_1.RATE_LIMIT_WINDOW,
    audioDir: config_1.AUDIO_DIR,
    publicDir: config_1.PUBLIC_DIR,
});
app.listen(config_1.PORT, async () => {
    await pluginManager_1.ttsPluginManager.initializeEngines();
    console.log(`Server running on port ${config_1.PORT}`);
});
//# sourceMappingURL=server.js.map