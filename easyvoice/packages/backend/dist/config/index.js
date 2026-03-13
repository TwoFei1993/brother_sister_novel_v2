"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIRECT_GEN_LIMIT = exports.USE_LIMIT = exports.USE_HELMET = exports.LIMIT_TEXT_LENGTH_ERROR_MESSAGE = exports.LIMIT_TEXT_LENGTH = exports.TTS_KOKORO_URL = exports.REGISTER_KOKORO = exports.REGISTER_OPENAI_TTS = exports.PORT = exports.EDGE_API_LIMIT = exports.RATE_LIMIT = exports.RATE_LIMIT_WINDOW = exports.STATIC_DOMAIN = exports.MODEL_NAME = exports.OPENAI_API_KEY = exports.OPENAI_BASE_URL = exports.ALLOWED_EXTENSIONS = exports.PUBLIC_DIR = exports.AUDIO_CACHE_DIR = exports.AUDIO_DIR = exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = require("path");
dotenv_1.default.config({
    path: [
        (0, path_1.resolve)(__dirname, '..', '..', '.env'),
        (0, path_1.resolve)(__dirname, '..', '..', '..', '..', '.env'),
    ],
});
exports.config = {
    port: parseInt(process.env.PORT || '3000', 10),
};
exports.AUDIO_DIR = (0, path_1.join)(__dirname, '..', '..', 'audio');
exports.AUDIO_CACHE_DIR = (0, path_1.join)(exports.AUDIO_DIR, '.cache');
exports.PUBLIC_DIR = (0, path_1.join)(__dirname, '..', '..', 'public');
exports.ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.srt']);
exports.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
exports.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
exports.MODEL_NAME = process.env.MODEL_NAME;
exports.STATIC_DOMAIN = process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '';
exports.RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '0') || 10;
exports.RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '0') || 1e6;
exports.EDGE_API_LIMIT = parseInt(process.env.EDGE_API_LIMIT || '3') || 3;
exports.PORT = parseInt(process.env.PORT || '3000') || 3000;
exports.REGISTER_OPENAI_TTS = process.env.REGISTER_OPENAI_TTS || false;
exports.REGISTER_KOKORO = process.env.REGISTER_KOKORO || false;
exports.TTS_KOKORO_URL = process.env.TTS_KOKORO_URL || 'http://localhost:8880/v1';
exports.LIMIT_TEXT_LENGTH = parseInt(process.env.LIMIT_TEXT_LENGTH || '0');
exports.LIMIT_TEXT_LENGTH_ERROR_MESSAGE = process.env.LIMIT_TEXT_LENGTH_ERROR_MESSAGE;
exports.USE_HELMET = process.env.USE_HELMET === 'true' || false;
exports.USE_LIMIT = process.env.USE_LIMIT === 'true' || false;
exports.DIRECT_GEN_LIMIT = process.env.DIRECT_GEN_LIMIT || 200;
//# sourceMappingURL=index.js.map