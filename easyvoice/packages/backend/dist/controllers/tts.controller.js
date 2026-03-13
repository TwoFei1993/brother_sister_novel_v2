"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTask = createTask;
exports.getTask = getTask;
exports.getTaskStats = getTaskStats;
exports.generateAudio = generateAudio;
exports.downloadAudio = downloadAudio;
exports.getVoiceList = getVoiceList;
const tts_service_1 = require("../services/tts.service");
const logger_1 = require("../utils/logger");
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const config_1 = require("../config");
const taskManager_1 = __importDefault(require("../utils/taskManager"));
function formatBody({ text, pitch, voice, volume, rate, useLLM }) {
    const positivePercent = (value) => {
        if (value === '0%' || value === '0' || value === undefined)
            return '+0%';
        return value;
    };
    const positiveHz = (value) => {
        if (value === '0Hz' || value === '0' || value === undefined)
            return '+0Hz';
        return value;
    };
    return {
        text: text.trim(),
        pitch: positiveHz(pitch),
        voice: positivePercent(voice),
        rate: positivePercent(rate),
        volume: positivePercent(volume),
        useLLM,
    };
}
async function createTask(req, res, next) {
    try {
        logger_1.logger.debug('Generating audio with body:', req.body);
        const formattedBody = formatBody(req.body);
        const task = taskManager_1.default.createTask(formattedBody);
        logger_1.logger.info(`Generated task ID: ${task.id}`);
        (0, tts_service_1.generateTTS)(formattedBody, task)
            .then((result) => {
            const data = {
                ...result,
                file: path_1.default.parse(result.audio).base,
                srt: path_1.default.parse(result.srt).base,
            };
            taskManager_1.default.updateTask(task.id, { result: data });
            logger_1.logger.info(`Updated task ID: ${task.id} with result`, result);
        })
            .catch((err) => {
            const data = {
                message: err.message,
            };
            taskManager_1.default.failTask(task.id, data);
        });
        const data = {
            success: true,
            data: { ...task },
            code: 200,
        };
        res.json(data);
    }
    catch (error) {
        next(error);
    }
}
async function getTask(req, res, next) {
    const taskId = req.params.id;
    try {
        const task = taskManager_1.default.getTask(taskId);
        if (!task) {
            res.status(404).json({ success: false, message: 'Task not found', code: 404 });
            return;
        }
        const data = {
            success: true,
            data: { ...task },
            code: 200,
        };
        res.json(data);
    }
    catch (error) {
        next(error);
    }
}
async function getTaskStats(_req, res, next) {
    try {
        const stats = taskManager_1.default.getTaskStats();
        logger_1.logger.debug('stats:', stats);
        if (!stats) {
            res.status(404).json({ success: false, message: 'stats not found', code: 404 });
            return;
        }
        const data = {
            success: true,
            data: { ...stats },
            code: 200,
        };
        res.json(data);
    }
    catch (error) {
        next(error);
    }
}
async function generateAudio(req, res, next) {
    try {
        logger_1.logger.debug('Generating audio with body:', req.body);
        const formattedBody = formatBody(req.body);
        let result = await (0, tts_service_1.generateTTS)(formattedBody);
        const responseResult = {
            success: true,
            data: {
                ...result,
                file: path_1.default.parse(result.audio).base,
                srt: path_1.default.parse(result.srt).base,
            },
            code: 200,
        };
        res.json(responseResult);
    }
    catch (error) {
        next(error);
    }
}
async function downloadAudio(req, res) {
    const fileName = req.params.file;
    try {
        if (!fileName || typeof fileName !== 'string') {
            throw new Error('Invalid file name');
        }
        const fileExt = path_1.default.extname(fileName).toLowerCase();
        if (!config_1.ALLOWED_EXTENSIONS.has(fileExt)) {
            throw new Error('Invalid file type');
        }
        const safeFileName = path_1.default.basename(fileName);
        const encodedFileName = encodeURIComponent(safeFileName);
        const filePath = path_1.default.join(config_1.AUDIO_DIR, safeFileName);
        await promises_1.default.access(filePath, promises_1.default.constants.R_OK);
        res.setHeader('Content-Type', `audio/${fileExt.slice(1)}`);
        res.setHeader('Content-Disposition', `attachment; filename="${encodedFileName}"`);
        res.download(filePath, safeFileName, (err) => {
            if (err) {
                throw err;
            }
            logger_1.logger.info(`Successfully downloaded file: ${safeFileName}`);
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error(`Download failed for ${fileName}: ${errorMessage}`);
        const statusCode = errorMessage.includes('Invalid')
            ? 400
            : errorMessage.includes('ENOENT')
                ? 404
                : 500;
        res.status(statusCode).json({
            error: 'Failed to download file',
            message: errorMessage,
        });
    }
}
async function getVoiceList(req, res, next) {
    try {
        logger_1.logger.debug('Fetching voice list...');
        const voices = require('../llm/prompt/voice.json');
        res.json({
            code: 200,
            data: voices,
            success: true,
        });
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger_1.logger.error(`getVoiceList Error: ${errorMessage}`);
        res.status(500).json({
            code: 500,
            message: errorMessage,
            success: false,
        });
    }
}
//# sourceMappingURL=tts.controller.js.map