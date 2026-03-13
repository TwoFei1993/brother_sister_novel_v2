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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTTSStream = generateTTSStream;
exports.generateTTSStreamJson = generateTTSStreamJson;
exports.handleSrt = handleSrt;
exports.concatDirAudio = concatDirAudio;
exports.concatDirSrt = concatDirSrt;
const path_1 = __importStar(require("path"));
const promises_1 = __importStar(require("fs/promises"));
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
const stream_1 = require("stream");
const fs_1 = require("fs");
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
})(ErrorMessages || (ErrorMessages = {}));
/**
 * 流式生成文本转语音 (TTS) 的音频和字幕
 */
async function generateTTSStream(params, task) {
    const { text, pitch, voice, rate, volume, useLLM } = params;
    const segment = { id: (0, utils_1.generateId)(useLLM ? 'aigen-' : voice, text), text };
    const { lang, voiceList } = await (0, utils_1.getLangConfig)(segment.text);
    logger_1.logger.debug(`Language detected lang: `, lang);
    task.context.segment = segment;
    task.context.lang = lang;
    task.context.voiceList = voiceList;
    const { res } = task.context;
    if (!validateLangAndVoice(lang, voice, res)) {
        task?.endTask?.(task.id);
        return;
    }
    // 检查缓存, 如果有缓存则直接返回
    const cacheKey = taskManager_1.default.generateTaskId({ text, pitch, voice, rate, volume });
    const cache = await audioCache_service_1.default.getAudio(cacheKey);
    if (cache) {
        const data = {
            ...cache,
            file: path_1.default.parse(cache.audio).base,
            srt: path_1.default.parse(cache.srt).base,
            text: '',
        };
        logger_1.logger.info(`Cache hit: ${voice} ${text.slice(0, 10)}`);
        task.context?.res?.setHeader('x-generate-tts-type', 'application/json');
        task.context?.res?.setHeader('Access-Control-Expose-Headers', 'x-generate-tts-type');
        task.context?.res?.json({ code: 200, data, success: true });
        task.endTask?.(task.id);
        return;
    }
    if (useLLM) {
        generateWithLLMStream(task);
    }
    else {
        generateWithoutLLMStream({ ...params, output: segment.id }, task);
    }
}
async function generateTTSStreamJson(formatedBody, task) {
    const { segment } = task.context;
    const output = path_1.default.resolve(config_1.AUDIO_DIR, segment.id);
    const segments = formatedBody;
    logger_1.logger.info(`generateTTSStreamJson splitText length: ${formatedBody.length} `);
    const buildSegments = segments.map((segment) => ({ ...segment, output }));
    logger_1.logger.info('buildSegments:', buildSegments);
    buildSegmentList(buildSegments, task);
}
/**
 * 使用 LLM 生成 TTS
 */
async function generateWithLLMStream(task) {
    const { segment, voiceList, lang, res } = task.context;
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
        logger_1.logger.debug(`Prompt for LLM: ${prompt}`);
        const llmResponse = await fetchLLMSegment(prompt);
        let llmSegments = llmResponse?.result || llmResponse?.segments || [];
        if (!Array.isArray(llmSegments)) {
            throw new Error('LLM response is not an array, please switch to Edge TTS mode or use another model');
        }
        buildSegmentList(formatLlmSegments(llmSegments), task);
    }
    else {
        const output = (0, path_1.resolve)(config_1.AUDIO_DIR, id);
        let count = 0;
        logger_1.logger.info('Splitting text into multiple segments:', segments.length);
        const getProgress = () => {
            return Number(((count / segments.length) * 100).toFixed(2));
        };
        const localStream = (0, fs_1.createWriteStream)(output);
        const outputStream = new stream_1.PassThrough();
        outputStream.pipe(res);
        outputStream.pipe(localStream);
        for (let seg of segments) {
            count++;
            const prompt = (0, generateSegment_1.getPrompt)(lang, voiceList, seg);
            logger_1.logger.debug(`Prompt for LLM: ${prompt}`);
            const llmResponse = await fetchLLMSegment(prompt);
            let llmSegments = llmResponse?.result || llmResponse?.segments || [];
            if (!Array.isArray(llmSegments)) {
                throw new Error('LLM response is not an array, please switch to Edge TTS mode or use another model');
            }
            for (let segment of formatLlmSegments(llmSegments)) {
                const stream = (await (0, edge_tts_service_1.generateSingleVoiceStream)({
                    ...segment,
                    output,
                    outputType: 'stream',
                }));
                stream.pipe(outputStream, { end: false });
                await new Promise((resolve) => {
                    stream.on('end', resolve);
                });
            }
            logger_1.logger.info(`Progress: ${getProgress()}%`);
        }
        outputStream.end();
        setTimeout(() => {
            handleSrt(output);
        }, 200);
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
async function generateWithoutLLMStream(params, task) {
    const { segment } = task.context;
    const { text } = segment;
    const { length, segments } = (0, text_service_1.splitText)(text);
    logger_1.logger.info(`splitText length: ${length} `);
    if (length <= 1) {
        buildSegment(params, task);
    }
    else {
        const buildSegments = segments.map((segment) => ({ ...params, text: segment }));
        buildSegmentList(buildSegments, task);
    }
}
/**
 * 生成单个片段的音频和字幕
 */
async function buildSegment(params, task, dir = '') {
    const { segment } = task.context;
    const output = path_1.default.resolve(config_1.AUDIO_DIR, dir, segment.id);
    const stream = (await (0, edge_tts_service_1.generateSingleVoiceStream)({
        ...params,
        output,
        outputType: 'stream',
    }));
    const { res } = task.context;
    (0, utils_1.streamToResponse)(res, stream, {
        headers: {
            'content-type': 'application/octet-stream',
            'x-generate-tts-type': 'stream',
            'Access-Control-Expose-Headers-generate-tts-id': task.id,
        },
        fileName: segment.id,
        onError: (err) => `Custom error: ${err.message}`,
        onEnd: () => {
            task?.endTask?.(task.id);
            logger_1.logger.info(`Streaming ${task.id} finished`);
            setTimeout(() => {
                handleSrt(output);
            }, 200);
        },
    });
}
async function handleSrt(audioPath, stream = true) {
    if (!stream) {
        const tempJsonPath = audioPath + '.json';
        await (0, edge_tts_service_1.generateSrt)(tempJsonPath, audioPath.replace('.mp3', '.srt'));
        return;
    }
    const { dir, base } = path_1.default.parse(audioPath);
    const tmpDir = audioPath + '_tmp';
    await (0, utils_1.ensureDir)(tmpDir);
    const fileList = (await (0, promises_1.readdir)(tmpDir))
        .filter((file) => file.includes(base) && file.includes('.json'))
        .sort((a, b) => Number(a.split('.json.')?.[1] || 0) - Number(b.split('.json.')?.[1] || 0))
        .map((file) => path_1.default.join(tmpDir, file));
    if (!fileList.length)
        return;
    concatDirSrt({ jsonFiles: fileList, inputDir: tmpDir, outputFile: audioPath });
}
async function buildSegmentList(segments, task) {
    const { res, segment } = task.context;
    const { id: outputId } = segment;
    const totalSegments = segments.length;
    const output = path_1.default.resolve(config_1.AUDIO_DIR, outputId);
    let completedSegments = 0;
    if (!totalSegments) {
        task?.endTask?.(task.id);
        return void res.status(400).end('No segments provided');
    }
    const progress = () => Number(((completedSegments / totalSegments) * 100).toFixed(2));
    const outputStream = new stream_1.PassThrough();
    (0, utils_1.streamToResponse)(res, outputStream, {
        headers: {
            'content-type': 'application/octet-stream',
            'x-generate-tts-type': 'stream',
            'Access-Control-Expose-Headers-generate-tts-id': task.id,
        },
        onError: (err) => `Custom error: ${err.message}`,
        fileName: segment.id,
        onEnd: () => {
            task?.endTask?.(task.id);
            logger_1.logger.info(`Streaming ${task.id} finished`);
            setTimeout(() => {
                handleSrt(output);
            }, 200);
        },
        onClose: () => {
            task?.endTask?.(task.id);
            logger_1.logger.info(`Streaming ${task.id} closed`);
        },
    });
    const processSegment = async (index, maxRetries = 3) => {
        if (index >= totalSegments) {
            outputStream.end();
            task?.endTask?.(task.id);
            return;
        }
        const segment = segments[index];
        const generateWithRetry = async (attempt = 0) => {
            try {
                return (await (0, edge_tts_service_1.generateSingleVoiceStream)({
                    ...segment,
                    outputType: 'stream',
                    output,
                }));
            }
            catch (err) {
                const error = err;
                if (attempt + 1 >= maxRetries) {
                    throw Object.assign(error, { segmentIndex: index, attempt: attempt + 1 });
                }
                logger_1.logger.warn(`Segment ${index + 1} failed (attempt ${attempt + 1}/${maxRetries}): ${error.message}`);
                await (0, utils_1.asyncSleep)(1000);
                return generateWithRetry(attempt + 1);
            }
        };
        try {
            // TODO: Concurrency of streaming flow
            const audioStream = await generateWithRetry();
            await audioStream.pipe(outputStream, { end: false });
            await new Promise((resolve) => audioStream.on('end', resolve));
            completedSegments++;
            logger_1.logger.info(`processing text:\n ${segment.text.slice(0, 10)}...`);
            logger_1.logger.info(`Segment ${index + 1}/${totalSegments} completed. Progress: ${progress()}%`);
            await processSegment(index + 1);
        }
        catch (err) {
            const { segmentIndex, attempt, message } = err;
            logger_1.logger.error(`Segment ${segmentIndex + 1} failed after ${attempt} retries: ${message}`);
            outputStream.emit('error', err);
        }
    };
    try {
        await processSegment(0);
    }
    catch (err) {
        logger_1.logger.error(`Audio processing aborted: ${err.message}`);
        !res.headersSent && res.status(500).end('Internal server error');
    }
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
function validateLangAndVoice(lang, voice, res) {
    if (lang !== 'eng' && voice.startsWith('en')) {
        res.status(400).send({
            code: 400,
            success: false,
            message: ErrorMessages.ENG_MODEL_INVALID_TEXT,
        });
        return false;
    }
    return true;
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
async function concatDirSrt({ fileList, outputFile, inputDir, jsonFiles, }) {
    const _jsonFiles = jsonFiles ||
        sortAudioDir(fileList.map((file) => `${file}.json`), '.json');
    if (!_jsonFiles.length)
        throw new Error('No JSON files found for subtitles');
    const subtitleFiles = await Promise.all(_jsonFiles.map((file) => (0, utils_1.readJson)(file)));
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
//# sourceMappingURL=tts.stream.service.js.map