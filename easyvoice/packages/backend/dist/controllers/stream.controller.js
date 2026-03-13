"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTaskStream = createTaskStream;
exports.generateJson = generateJson;
const path_1 = __importDefault(require("path"));
const logger_1 = require("../utils/logger");
const taskManager_1 = __importDefault(require("../utils/taskManager"));
const tts_stream_service_1 = require("../services/tts.stream.service");
const utils_1 = require("../utils");
function formatBody({ text, pitch, voice, volume, rate, useLLM }) {
    const positivePercent = (value) => {
        if (value === '0%' || value === '0' || value === undefined || value === '')
            return '+0%';
        return value;
    };
    const positiveHz = (value) => {
        if (value === '0Hz' || value === '0' || value === undefined || value === '')
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
/**
 * @description 流式返回音频, 支持长文本
 * @param req
 * @param res
 * @param next
 * @returns ReadableStream
 */
async function createTaskStream(req, res, next) {
    try {
        if (req.query?.mock) {
            logger_1.logger.info('Mocking audio stream...');
            (0, utils_1.streamWithLimit)(res, path_1.default.join(__dirname, '../../mock/flying.mp3'), 1280); // Mock stream with limit
            return;
        }
        logger_1.logger.debug('Generating audio with body:', req.body);
        const formattedBody = formatBody(req.body);
        const task = taskManager_1.default.createTask(formattedBody);
        task.context = { req, res, body: req.body };
        logger_1.logger.info(`Generated stream task ID: ${task.id}`);
        (0, tts_stream_service_1.generateTTSStream)(formattedBody, task);
    }
    catch (error) {
        console.log(`createTaskStream error:`, error);
        next(error);
    }
}
async function generateJson(req, res, next) {
    try {
        const data = req.body?.data;
        logger_1.logger.debug('generateJson with body:', data);
        const formatedBody = data.map((item) => formatBody(item));
        const text = data.map((item) => item.text).join('');
        const taskParams = {
            ...formatedBody[0],
            text,
        };
        const task = taskManager_1.default.createTask(taskParams);
        const voice = formatedBody[0].voice;
        const segment = { id: (0, utils_1.generateId)(voice, text), text };
        task.context = { req, res, segment, body: req.body };
        logger_1.logger.info(`Generated stream task ID: ${task.id}`);
        (0, tts_stream_service_1.generateTTSStreamJson)(formatedBody, task);
    }
    catch (error) {
        console.log(`createTaskStream error:`, error);
        next(error);
    }
}
//# sourceMappingURL=stream.controller.js.map