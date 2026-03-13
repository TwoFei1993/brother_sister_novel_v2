"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorMessages = void 0;
exports.generateTTS = generateTTS;
exports.concatDirAudio = concatDirAudio;
exports.concatDirSrt = concatDirSrt;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const generateSegment_1 = require("../llm/prompt/generateSegment");
const utils_1 = require("../utils");
const openai_1 = require("../utils/openai");
const text_service_1 = require("./text.service");
const edge_tts_service_1 = require("./edge-tts.service");
const concurrency_controller_1 = require("../controllers/concurrency.controller");
const audioCache_service_1 = __importDefault(require("./audioCache.service"));
const subtitle_1 = require("../utils/subtitle");
const taskManager_1 = __importDefault(require("../utils/taskManager"));
const tts_stream_service_1 = require("./tts.stream.service");
// 错误消息枚举
var ErrorMessages;
(function (ErrorMessages) {
    ErrorMessages["ENG_MODEL_INVALID_TEXT"] = "English model cannot process non-English text";
    ErrorMessages["API_FETCH_FAILED"] = "Failed to fetch TTS parameters from API";
    ErrorMessages["INVALID_API_RESPONSE"] = "Invalid API response: no TTS parameters returned";
    ErrorMessages["PARAMS_PARSE_FAILED"] = "Failed to parse TTS parameters";
    ErrorMessages["INVALID_PARAMS_FORMAT"] = "Invalid TTS parameters format";
    ErrorMessages["TTS_GENERATION_FAILED"] = "TTS generation failed";
    ErrorMessages["INCOMPLETE_RESULT"] = "Incomplete TTS result";
})(ErrorMessages || (exports.ErrorMessages = ErrorMessages = {}));
/**
 * 生成文本转语音 (TTS) 的音频和字幕
 */
async function generateTTS(params, task) {
    const { text, pitch, voice, rate, volume, useLLM } = params;
    // 检查缓存
    const cacheKey = taskManager_1.default.generateTaskId({ text, pitch, voice, rate, volume });
    const cache = await audioCache_service_1.default.getAudio(cacheKey);
    if (cache) {
        logger_1.logger.info(`Cache hit: ${voice} ${text.slice(0, 10)}`);
        return cache;
    }
    const segment = { id: (0, utils_1.generateId)(`${useLLM ? 'aigen-' : voice}`, text), text };
    const { lang, voiceList } = await (0, utils_1.getLangConfig)(segment.text);
    logger_1.logger.debug(`Language detected lang: `, lang);
    validateLangAndVoice(lang, voice);
    let result;
    if (useLLM) {
        result = await generateWithLLM(segment, voiceList, lang, task);
    }
    else {
        result = await generateWithoutLLM(segment, {
            text,
            pitch,
            voice,
            rate,
            volume,
            output: segment.id,
        }, task);
    }
    // 验证结果并缓存
    validateTTSResult(result, segment.id);
    logger_1.logger.info(`Generated audio succeed: `, result);
    if (result.partial) {
        logger_1.logger.warn(`Partial result detected, some splits generated audio failed!`);
    }
    else {
        await audioCache_service_1.default.setAudio(cacheKey, { ...params, ...result });
    }
    return result;
}
/**
 * 使用 LLM 生成 TTS
 */
async function generateWithLLM(segment, voiceList, lang, task) {
    const { text, id } = segment;
    const { length, segments } = (0, text_service_1.splitText)(text.trim());
    const formatLlmSegments = (llmSegments) => llmSegments
        .filter((segment) => segment.text)
        .map((segment) => ({
        ...segment,
        voice: segment.name,
    }));
    if (length <= 1) {
        const prompt = (0, generateSegment_1.getPrompt)(lang, voiceList, segments[0]);
        // logger.debug(`Prompt for LLM: ${prompt}`)
        const llmResponse = await fetchLLMSegment(prompt);
        let llmSegments = llmResponse?.result || llmResponse?.segments || [];
        if (!Array.isArray(llmSegments)) {
            task?.endTask?.(task.id);
            throw new Error('LLM response is not an array, please switch to Edge TTS mode or use another model');
        }
        const result = await buildSegmentList(segment, formatLlmSegments(llmSegments), task);
        task?.updateProgress?.(task.id, 100);
        return result;
    }
    else {
        logger_1.logger.info('Splitting text into multiple segments:', segments.length);
        let finalSegments = [];
        let count = 0;
        const getProgress = () => {
            return Number(((count / segments.length) * 100).toFixed(2));
        };
        for (let seg of segments) {
            count++;
            const prompt = (0, generateSegment_1.getPrompt)(lang, voiceList, seg);
            // logger.debug(`Prompt for LLM: ${prompt}`)
            const llmResponse = await fetchLLMSegment(prompt);
            let llmSegments = llmResponse?.result || llmResponse?.segments || [];
            if (!Array.isArray(llmSegments)) {
                throw new Error('LLM response is not an array, please switch to Edge TTS mode or use another model');
            }
            const result = await buildSegmentList({ ...segment, id: `[segments:${count}]${segment.id}` }, formatLlmSegments(llmSegments));
            task?.updateProgress?.(task.id, getProgress());
            finalSegments.push(result);
        }
        return await buildFinal(finalSegments, id);
    }
}
const buildFinal = async (finalSegments, id) => {
    const subtitleFiles = await Promise.all(finalSegments.map((file) => {
        const base = path_1.default.basename(file.audio);
        const jsonPath = path_1.default.resolve(config_1.AUDIO_DIR, base.replace('.mp3', ''), 'all_splits.mp3.json');
        return (0, utils_1.readJson)(jsonPath);
    }));
    const mergedJson = (0, subtitle_1.mergeSubtitleFiles)(subtitleFiles);
    const finalDir = path_1.default.resolve(config_1.AUDIO_DIR, id.replace('.mp3', ''));
    await (0, utils_1.ensureDir)(finalDir);
    const finalJson = path_1.default.resolve(finalDir, '[merged]all_splits.mp3.json');
    await promises_1.default.writeFile(finalJson, JSON.stringify(mergedJson, null, 2));
    await (0, edge_tts_service_1.generateSrt)(finalJson, path_1.default.resolve(config_1.AUDIO_DIR, id.replace('.mp3', '.srt')));
    const fileList = finalSegments.map((segment) => path_1.default.resolve(config_1.AUDIO_DIR, path_1.default.parse(segment.audio).base));
    const outputFile = path_1.default.resolve(config_1.AUDIO_DIR, id);
    await concatDirAudio({ inputDir: finalDir, fileList, outputFile });
    return {
        audio: `${config_1.STATIC_DOMAIN}/${id}`,
        srt: `${config_1.STATIC_DOMAIN}/${id.replace('.mp3', '.srt')}`,
    };
};
/**
 * 不使用 LLM 生成 TTS
 */
async function generateWithoutLLM(segment, params, task) {
    const { text, pitch, voice, rate, volume } = params;
    const { length, segments } = (0, text_service_1.splitText)(text);
    if (length <= 1) {
        return buildSegment(segment, params);
    }
    else {
        const buildSegments = segments.map((segment) => ({ ...params, text: segment }));
        let result = await buildSegmentList(segment, buildSegments, task);
        task?.updateProgress?.(task.id, 100);
        return result;
    }
}
/**
 * 生成单个片段的音频和字幕
 */
async function buildSegment(segment, params, dir = '') {
    const { id, text } = segment;
    const { pitch, voice, rate, volume } = params;
    const output = path_1.default.resolve(config_1.AUDIO_DIR, dir, id);
    const result = await (0, edge_tts_service_1.generateSingleVoice)({
        text,
        pitch,
        voice,
        rate,
        volume,
        output,
    });
    logger_1.logger.info('Generated single segment:', result);
    setTimeout(() => {
        (0, tts_stream_service_1.handleSrt)(output, false);
    }, 200);
    return {
        audio: `${config_1.STATIC_DOMAIN}/${path_1.default.join(dir, id)}`,
        srt: `${config_1.STATIC_DOMAIN}/${path_1.default.join(dir, id.replace('.mp3', '.srt'))}`,
    };
}
/**
 * 生成多个片段并合并的 TTS
 */
async function buildSegmentList(segment, segments, task) {
    const fileList = [];
    const length = segments.length;
    let handledLength = 0;
    if (!length) {
        throw new Error(`No segments found for task ${task?.id || 'unknown'}!`);
    }
    const { id } = segment;
    const tmpDirName = id.replace('.mp3', '');
    const tmpDirPath = path_1.default.resolve(config_1.AUDIO_DIR, tmpDirName);
    await (0, utils_1.ensureDir)(tmpDirPath);
    await promises_1.default.writeFile(path_1.default.resolve(tmpDirPath, 'ai-segments.json'), JSON.stringify(segments, null, 2));
    const getProgress = () => {
        return Number((((handledLength / length) * 100) / (id.includes('segment') ? 2 : 1)).toFixed(2));
    };
    const tasks = segments.map((segment, index) => async () => {
        const { text, pitch, voice, rate, volume } = segment;
        const output = path_1.default.resolve(tmpDirPath, `${index + 1}_splits.mp3`);
        const cacheKey = taskManager_1.default.generateTaskId({ text, pitch, voice, rate, volume });
        const cache = await audioCache_service_1.default.getAudio(cacheKey);
        if (cache) {
            logger_1.logger.info(`Cache hit[segments]: ${voice} ${text.slice(0, 10)}`);
            fileList.push(cache.audio);
            return cache;
        }
        const result = await (0, edge_tts_service_1.generateSingleVoice)({ text, pitch, voice, rate, volume, output });
        logger_1.logger.debug(`Cache miss and generate audio: ${result.audio}, ${result.srt}`);
        fileList.push(result.audio);
        handledLength++;
        task?.updateProgress?.(task.id, getProgress());
        const params = { text, pitch, voice, rate, volume };
        await audioCache_service_1.default.setAudio(cacheKey, { ...params, ...result });
        return result;
    });
    let partial = false;
    const results = await runConcurrentTasks(tasks, config_1.EDGE_API_LIMIT);
    if (results?.some((result) => !result.success)) {
        logger_1.logger.warn(`Partial result detected, some splits generated audio failed!`, results);
        partial = true;
    }
    const outputFile = path_1.default.resolve(config_1.AUDIO_DIR, id);
    logger_1.logger.debug(`Concatenating audio files from ${tmpDirPath} to ${outputFile}`);
    await concatDirAudio({ inputDir: tmpDirPath, fileList, outputFile });
    await concatDirSrt({ inputDir: tmpDirPath, fileList, outputFile });
    logger_1.logger.debug(`Concatenating SRT files from ${tmpDirPath} to ${outputFile.replace('.mp3', '.srt')}`);
    return {
        audio: `${config_1.STATIC_DOMAIN}/${id}`,
        srt: `${config_1.STATIC_DOMAIN}/${id.replace('.mp3', '.srt')}`,
        partial,
    };
}
/**
 * 并发执行任务
 */
async function runConcurrentTasks(tasks, limit) {
    logger_1.logger.debug(`Running ${tasks.length} tasks with a limit of ${limit}`);
    const controller = new concurrency_controller_1.MapLimitController(tasks, limit, () => logger_1.logger.info('All concurrent tasks completed'));
    const { results, cancelled } = await controller.run();
    logger_1.logger.info(`Tasks completed: ${results.length}, cancelled: ${cancelled}`);
    logger_1.logger.debug(`Task results:`, results);
    return results;
}
/**
 * 验证语言和语音参数
 */
function validateLangAndVoice(lang, voice) {
    if (lang !== 'eng' && voice.startsWith('en')) {
        throw new Error(ErrorMessages.ENG_MODEL_INVALID_TEXT);
    }
}
/**
 * 从 LLM 获取分段参数
 */
async function fetchLLMSegment(prompt) {
    const response = await openai_1.openai.createChatCompletion({
        messages: [
            {
                role: 'system',
                content: 'You are a helpful assistant. And you can return valid json object',
            },
            { role: 'user', content: prompt },
        ],
        // temperature: 0.7,
        // max_tokens: 500,
        response_format: { type: 'json_object' },
    });
    if (!response.choices[0].message.content) {
        throw new Error(ErrorMessages.INVALID_API_RESPONSE);
    }
    return parseLLMResponse(response);
}
/**
 * 解析 LLM 响应
 */
function parseLLMResponse(response) {
    const params = JSON.parse(response.choices[0].message.content);
    if (!params || typeof params !== 'object') {
        throw new Error(ErrorMessages.INVALID_PARAMS_FORMAT);
    }
    return params;
}
/**
 * 验证 TTS 结果
 */
function validateTTSResult(result, segmentId) {
    if (!result.audio) {
        throw new Error(`${ErrorMessages.INCOMPLETE_RESULT} for segment ${segmentId}`);
    }
}
/**
 * 拼接音频文件
 */
async function concatDirAudio({ fileList, outputFile, inputDir, }) {
    const mp3Files = sortAudioDir(fileList, '.mp3');
    if (!mp3Files.length)
        throw new Error('No MP3 files found in input directory');
    const tempListPath = path_1.default.resolve(inputDir, 'file_list.txt');
    await promises_1.default.writeFile(tempListPath, mp3Files.map((file) => `file '${file}'`).join('\n'));
    await new Promise((resolve, reject) => {
        (0, fluent_ffmpeg_1.default)()
            .input(tempListPath)
            .inputFormat('concat')
            .inputOption('-safe', '0')
            .audioCodec('copy')
            .output(outputFile)
            .on('end', () => resolve())
            .on('error', (err) => reject(new Error(`Concat failed: ${err.message}`)))
            .run();
    });
}
/**
 * 拼接字幕文件
 */
async function concatDirSrt({ fileList, outputFile, inputDir, }) {
    const jsonFiles = sortAudioDir(fileList.map((file) => `${file}.json`), '.json');
    if (!jsonFiles.length)
        throw new Error('No JSON files found for subtitles');
    const subtitleFiles = await Promise.all(jsonFiles.map((file) => (0, utils_1.readJson)(file)));
    const mergedJson = (0, subtitle_1.mergeSubtitleFiles)(subtitleFiles);
    const tempJsonPath = path_1.default.resolve(inputDir, 'all_splits.mp3.json');
    await promises_1.default.writeFile(tempJsonPath, JSON.stringify(mergedJson, null, 2));
    await (0, edge_tts_service_1.generateSrt)(tempJsonPath, outputFile.replace('.mp3', '.srt'));
}
/**
 * 按文件名排序音频文件
 */
function sortAudioDir(fileList, ext = '.mp3') {
    return fileList
        .filter((file) => path_1.default.extname(file).toLowerCase() === ext)
        .sort((a, b) => Number(path_1.default.parse(a).name.split('_')[0]) - Number(path_1.default.parse(b).name.split('_')[0]));
}
//# sourceMappingURL=tts.service.js.map