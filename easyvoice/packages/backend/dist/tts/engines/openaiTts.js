"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAITtsEngine = void 0;
const request_1 = require("../../utils/request");
const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const RESPONSE_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];
class OpenAITtsEngine {
    constructor(apiKey) {
        this.name = 'openai-tts';
        if (!apiKey) {
            throw new Error('OpenAI TTS requires an API key.');
        }
        this.apiKey = apiKey;
    }
    async synthesize(text, options) {
        const { speed = 1.0, voice = 'alloy', format = 'mp3' } = options;
        if (typeof text !== 'string' || text.length === 0) {
            throw new Error('Input text is required.');
        }
        if (text.length > 4096) {
            throw new Error('Input text exceeds 4096 characters, which is the maximum allowed by OpenAI TTS.');
        }
        if (!OPENAI_VOICES.includes(voice)) {
            throw new Error(`Invalid voice: ${voice}. Supported voices are: ${OPENAI_VOICES.join(', ')}.`);
        }
        if (speed < 0.25 || speed > 4.0) {
            throw new Error('Speed must be between 0.25 and 4.0.');
        }
        if (!RESPONSE_FORMATS.includes(format)) {
            throw new Error(`Invalid response format: ${format}. Supported formats are: ${RESPONSE_FORMATS.join(', ')}.`);
        }
        try {
            const response = await request_1.fetcher.post('https://api.openai.com/v1/audio/speech', {
                model: 'gpt-4o-mini-tts',
                input: text,
                voice,
                speed,
                response_format: format,
            }, {
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                responseType: 'arraybuffer',
            });
            return Buffer.from(response.data);
        }
        catch (error) {
            const err = error;
            if (err.response?.status === 401) {
                throw new Error('Invalid OpenAI API key.');
            }
            else if (err.response?.status === 429) {
                throw new Error('Rate limit exceeded for OpenAI TTS.');
            }
            throw new Error(`Failed to synthesize speech: ${err.message}`);
        }
    }
    async getSupportedLanguages() {
        return ['en-US', 'zh-CN', 'es-ES', 'fr-FR', 'de-DE', 'ja-JP'];
    }
    async getVoiceOptions() {
        return [...OPENAI_VOICES];
    }
}
exports.OpenAITtsEngine = OpenAITtsEngine;
//# sourceMappingURL=openaiTts.js.map