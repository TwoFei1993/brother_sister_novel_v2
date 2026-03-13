"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSrt = exports.jsonToSrt = exports.generateSingleVoiceStream = exports.generateSingleVoice = void 0;
exports.runEdgeTTS = runEdgeTTS;
const promises_1 = __importDefault(require("fs/promises"));
const edge_tts_fixed_1 = require("../lib/node-edge-tts/edge-tts-fixed");
const utils_1 = require("../utils");
async function runEdgeTTS({ text, pitch, volume, voice, rate, output, outputType = 'file', }) {
    const lang = /([a-zA-Z]{2,5}-[a-zA-Z]{2,5}\b)/.exec(voice)?.[1];
    const tts = new edge_tts_fixed_1.EdgeTTS({
        voice,
        lang,
        outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
        saveSubtitles: true,
        pitch,
        rate,
        volume,
        timeout: 30000,
    });
    console.log(`run with nodejs edge-tts service...`);
    if (outputType === 'file') {
        await tts.ttsPromise(text, { audioPath: output, outputType });
        return {
            audio: output,
            srt: output.replace('.mp3', '.srt'),
            file: '',
        };
    }
    return tts.ttsPromise(text, { audioPath: output, outputType: outputType });
}
const generateSingleVoice = async (params) => {
    let result = {
        audio: '',
        srt: '',
    };
    await (0, utils_1.safeRunWithRetry)(async () => {
        result = (await runEdgeTTS({ ...params }));
    }, { retries: 5 });
    return result;
};
exports.generateSingleVoice = generateSingleVoice;
const generateSingleVoiceStream = async (params) => {
    return runEdgeTTS({ ...params, outputType: 'stream' });
};
exports.generateSingleVoiceStream = generateSingleVoiceStream;
/**
 * 将毫秒转换为 SRT 时间格式（HH:MM:SS,MMM）
 * @param ms 毫秒数
 * @returns 格式化的时间字符串
 */
function formatTime(ms) {
    const hours = Math.floor(ms / 3600000)
        .toString()
        .padStart(2, '0');
    const minutes = Math.floor((ms % 3600000) / 60000)
        .toString()
        .padStart(2, '0');
    const seconds = Math.floor((ms % 60000) / 1000)
        .toString()
        .padStart(2, '0');
    const milliseconds = (ms % 1000).toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds},${milliseconds}`;
}
/**
 * 将字幕 JSON 数据转换为 SRT 格式字符串
 * @param subtitles 字幕数组
 * @returns SRT 格式的字符串
 */
function convertToSrt(subtitles) {
    let srtContent = '';
    subtitles.forEach((subtitle, index) => {
        const startTime = formatTime(subtitle.start);
        const endTime = formatTime(subtitle.end);
        srtContent += `${index + 1}\n`;
        srtContent += `${startTime} --> ${endTime}\n`;
        srtContent += `${subtitle.part}\n\n`;
    });
    return srtContent;
}
const jsonToSrt = async (jsonPath) => {
    const json = await (0, utils_1.readJson)(jsonPath);
    const srtResult = convertToSrt(json);
    return srtResult;
};
exports.jsonToSrt = jsonToSrt;
const generateSrt = async (jsonPath, srtPath, deleteJson = false) => {
    if (await (0, utils_1.fileExist)(srtPath)) {
        console.log(`SRT file already exists at ${srtPath}`);
        return;
    }
    try {
        const srtTxt = await (0, exports.jsonToSrt)(jsonPath);
        await promises_1.default.writeFile(srtPath, srtTxt, 'utf8');
        console.log(`SRT file created at ${srtPath}`);
        if (deleteJson)
            await promises_1.default.unlink(jsonPath);
        return srtPath;
    }
    catch (err) {
        console.error(`Error reading JSON file at ${jsonPath}:`, err);
        return;
    }
};
exports.generateSrt = generateSrt;
//# sourceMappingURL=edge-tts.service.js.map