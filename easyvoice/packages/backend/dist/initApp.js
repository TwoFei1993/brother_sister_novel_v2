"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initApp = initApp;
const utils_1 = require("./utils");
const config_1 = require("./config");
async function initApp() {
    await (0, utils_1.ensureDir)(config_1.AUDIO_DIR);
    await (0, utils_1.ensureDir)(config_1.PUBLIC_DIR);
}
//# sourceMappingURL=initApp.js.map