"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerEngines = registerEngines;
const pluginManager_1 = require("../pluginManager");
const edgeTts_1 = require("./edgeTts");
const openaiTts_1 = require("./openaiTts");
const kokoroTts_1 = require("./kokoroTts");
const config_1 = require("../../config");
function registerEngines() {
    pluginManager_1.ttsPluginManager.registerEngine(new edgeTts_1.EdgeTtsEngine());
    if (config_1.REGISTER_OPENAI_TTS) {
        pluginManager_1.ttsPluginManager.registerEngine(new openaiTts_1.OpenAITtsEngine(process.env.OPENAI_API_KEY));
    }
    if (config_1.REGISTER_KOKORO) {
        pluginManager_1.ttsPluginManager.registerEngine(new kokoroTts_1.KokoroTtsEngine(config_1.TTS_KOKORO_URL));
    }
}
//# sourceMappingURL=index.js.map