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
exports.getLangConfig = getLangConfig;
exports.readJson = readJson;
exports.ensureDir = ensureDir;
exports.safeRunWithRetry = safeRunWithRetry;
exports.asyncSleep = asyncSleep;
exports.generateId = generateId;
exports.safeFileName = safeFileName;
exports.fileExist = fileExist;
exports.formatFileSize = formatFileSize;
exports.streamToResponse = streamToResponse;
exports.streamWithLimit = streamWithLimit;
exports.escapeSSML = escapeSSML;
const promises_1 = __importDefault(require("fs/promises"));
const fs_1 = require("fs");
const path_1 = require("path");
const stream_1 = require("stream");
const logger_1 = require("./logger");
const config_1 = require("../config");
async function getLangConfig(text) {
    const { franc } = await Promise.resolve().then(() => __importStar(require('franc')));
    let lang = franc(text);
    if (lang === 'cmn') {
        lang = 'zh';
    }
    const voicePath = (0, path_1.resolve)(__dirname, `../llm/prompt/voice.json`);
    const voiceList = await readJson(voicePath);
    return { lang, voiceList };
}
async function readJson(path) {
    try {
        const data = await promises_1.default.readFile(path, 'utf-8');
        return JSON.parse(data);
    }
    catch (err) {
        console.log(`readJson ${path} error:`, err.message);
        return {};
    }
}
async function ensureDir(path) {
    try {
        await promises_1.default.access(path);
        console.log(`dir exists: ${path}`);
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            await promises_1.default.mkdir(path, { recursive: true });
            console.log(`create dir succed: ${path}`);
        }
        else {
            throw error;
        }
    }
}
async function safeRunWithRetry(fn, options = {}) {
    const { retries = 3, baseDelayMs = 200, onError = defaultErrorHandler } = options;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            onError(err, attempt + 1);
            if (attempt < retries - 1) {
                await asyncSleep(baseDelayMs * (attempt + 1));
            }
            else {
                throw err;
            }
        }
    }
    throw new Error('Unexpected execution flow'); // 理论上不会到达这里
}
// 默认错误处理器
function defaultErrorHandler(err, attempt) {
    const message = err instanceof Error ? err.message : String(err);
    const fnName = err?.fn?.name || 'anonymous';
    if (message.includes('Invalid response status')) {
        console.log(`Attempt ${attempt} failed for ${fnName}: ${message}`);
    }
    else {
        console.error(`Attempt ${attempt} failed for ${fnName}:`, err.message);
    }
}
async function asyncSleep(delay = 200) {
    return new Promise((resolve) => setTimeout(resolve, delay));
}
function generateId(voice, text) {
    const now = Date.now();
    return `${voice}-${safeFileName(text).slice(0, 10)}-${now}.mp3`;
}
function safeFileName(fileName) {
    return fileName.replace(/[/\\?%*:|"<>\r\n\s#]/g, '-');
}
async function fileExist(path) {
    try {
        await promises_1.default.access(path, promises_1.default.constants.F_OK);
        return true;
    }
    catch (err) {
        return false;
    }
}
function formatFileSize(bytes) {
    if (!bytes)
        return '';
    if (bytes === 0)
        return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
/**
 * 将流式数据发送到客户端的通用函数
 * @param res Express 响应对象
 * @param inputStream 输入流
 * @param options 配置选项
 */
function streamToResponse(res, inputStream, options = {}) {
    const { headers = {}, onError = (err) => `Error occurred: ${err.message}`, onEnd, onClose, fileName, } = options;
    const outputStream = new stream_1.PassThrough();
    let isClientDisconnected = false;
    Object.entries(headers).forEach(([key, value]) => {
        res.setHeader(key, value);
    });
    const handleDisconnect = () => {
        if (!isClientDisconnected) {
            isClientDisconnected = true;
            logger_1.logger.info('Client disconnected');
            // 清理流
            if ('destroy' in inputStream) {
                ;
                inputStream.destroy();
            }
            outputStream.destroy();
            if (onClose)
                onClose();
        }
    };
    res.on('close', handleDisconnect);
    res.on('finish', () => {
        logger_1.logger.info('Response finished');
    });
    // 输入流错误处理
    inputStream.on('error', (err) => {
        if (isClientDisconnected)
            return;
        logger_1.logger.error('Input stream error:', err);
        const errorMessage = onError(err);
        outputStream.write(errorMessage);
        outputStream.end();
    });
    // 输出流错误处理
    outputStream.on('error', (err) => {
        if (isClientDisconnected)
            return;
        logger_1.logger.error('Output stream error:', err);
        res.status(500).end('Internal server error');
    });
    // 流完成处理
    if (onEnd) {
        inputStream.on('end', () => {
            if (isClientDisconnected)
                return;
            logger_1.logger.info('Stream completed successfully');
            onEnd();
        });
    }
    inputStream.on('uncaughtException', (err) => {
        logger_1.logger.error('Uncaught exception in input stream:', err);
        if (!isClientDisconnected) {
            res.status(500).end('Internal server error');
        }
    });
    // 检查响应是否已可写
    if (!res.writable) {
        if ('destroy' in inputStream) {
            ;
            inputStream.destroy();
        }
        outputStream.destroy();
        return;
    }
    const streamer = inputStream.pipe(outputStream);
    streamer.pipe(res);
    if (fileName) {
        const streamFile = (0, path_1.resolve)(config_1.AUDIO_DIR, fileName);
        const localStream = (0, fs_1.createWriteStream)(streamFile);
        streamer.pipe(localStream);
    }
}
function streamWithLimit(res, filePath, bitrate = 128) {
    const byteRate = (bitrate * 1024) / 8; // kbps to bytes per second
    const chunkSize = byteRate / 10;
    const fileStream = (0, fs_1.createReadStream)(filePath);
    res.setHeader('Content-Type', 'audio/opus');
    let buffer = Buffer.alloc(0);
    fileStream.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!fileStream.isPaused() && buffer.length >= chunkSize * 2) {
            fileStream.pause();
        }
    });
    fileStream.on('end', () => {
        clearInterval(timer);
        res.end(buffer);
    });
    fileStream.on('error', (err) => {
        logger_1.logger.error(`Stream error: ${err.message}`);
        res.status(500).send(`Stream error: ${err.message}`);
    });
    const timer = setInterval(() => {
        if (buffer.length > 0) {
            const sendSize = Math.min(chunkSize, buffer.length);
            res.write(buffer.slice(0, sendSize));
            buffer = buffer.slice(sendSize);
            if (buffer.length < chunkSize && fileStream.isPaused()) {
                fileStream.resume();
            }
        }
    }, 100);
    res.on('close', () => {
        fileStream.destroy();
        clearInterval(timer);
    });
}
function escapeSSML(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
//# sourceMappingURL=index.js.map