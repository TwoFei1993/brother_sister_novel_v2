"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tts_controller_1 = require("../controllers/tts.controller");
const pick_controller_1 = require("../controllers/pick.controller");
const pluginManager_1 = require("../tts/pluginManager");
const stream_controller_1 = require("../controllers/stream.controller");
const generate_1 = require("../schema/generate");
const router = (0, express_1.Router)();
router.get('/engines', (req, res) => {
    const engines = pluginManager_1.ttsPluginManager.getAllEngines().map((engine) => ({
        name: engine.name,
        languages: engine.getSupportedLanguages(),
        voices: engine.getVoiceOptions?.() || [],
    }));
    res.json(engines);
});
router.get('/voiceList', tts_controller_1.getVoiceList);
router.get('/task/stats', tts_controller_1.getTaskStats);
router.get('/task/:id', tts_controller_1.getTask);
router.get('/download/:file', tts_controller_1.downloadAudio);
router.post('/create', pick_controller_1.pickSchema, tts_controller_1.createTask);
router.post('/createStream', pick_controller_1.pickSchema, stream_controller_1.createTaskStream);
router.post('/generate', pick_controller_1.pickSchema, tts_controller_1.generateAudio);
router.post('/generateJson', generate_1.validateJson, stream_controller_1.generateJson);
exports.default = router;
//# sourceMappingURL=tts.route.js.map