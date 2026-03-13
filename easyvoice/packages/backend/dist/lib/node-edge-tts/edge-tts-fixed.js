"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EdgeTTS = void 0;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const ws_1 = require("ws");
const path_1 = require("path");
const promises_1 = require("node:fs/promises");
const https_proxy_agent_1 = require("https-proxy-agent");
const drm_1 = require("./drm");
const node_stream_1 = require("node:stream");
const utils_1 = require("../../utils");
class EdgeTTS {
    constructor({ voice = 'zh-CN-XiaoyiNeural', lang = 'zh-CN', outputFormat = 'audio-24khz-48kbitrate-mono-mp3', wordBoundary = true, sentenceBoundary = false, saveSubtitles = false, proxy, rate = 'default', pitch = 'default', volume = 'default', timeout = 10000, } = {}) {
        this.voice = voice;
        this.lang = lang;
        this.outputFormat = outputFormat;
        this.saveSubtitles = saveSubtitles;
        this.wordBoundary = wordBoundary;
        this.sentenceBoundary = sentenceBoundary;
        this.proxy = proxy ?? '';
        this.rate = rate;
        this.pitch = pitch;
        this.volume = volume;
        this.timeout = timeout;
    }
    async _connectWebSocket() {
        const wsConnect = new ws_1.WebSocket(`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${drm_1.TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${(0, drm_1.generateSecMsGecToken)()}&Sec-MS-GEC-Version=1-${drm_1.CHROMIUM_FULL_VERSION}`, {
            host: 'speech.platform.bing.com',
            origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    + " (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
                    + " Edg/143.0.0.0",
            },
            agent: this.proxy ? new https_proxy_agent_1.HttpsProxyAgent(this.proxy) : undefined,
        });
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                wsConnect.close();
                reject(new Error('WebSocket connection timed out'));
            }, this.timeout);
            wsConnect.on('open', () => {
                clearTimeout(timeoutId);
                wsConnect.send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n
          {
            "context": {
              "synthesis": {
                "audio": {
                  "metadataoptions": {
                    "sentenceBoundaryEnabled": "${this.sentenceBoundary}",
                    "wordBoundaryEnabled": "${this.wordBoundary}"
                  },
                  "outputFormat": "${this.outputFormat}"
                }
              }
            }
          }
        `);
                resolve(wsConnect);
            });
            wsConnect.on('error', (err) => {
                clearTimeout(timeoutId);
                reject(new Error(`WebSocket error: ${err.message}`));
            });
            wsConnect.on('close', (code, reason) => {
                clearTimeout(timeoutId);
                if (code !== 1000) {
                    // 1000 表示正常关闭
                    reject(new Error(`WebSocket closed unexpectedly with code ${code}: ${reason.toString()}`));
                }
            });
        });
    }
    async getSrtPath(audioPath) {
        let basePath = audioPath + '.srt.json';
        let subPath = basePath;
        let counter = 1;
        try {
            await (0, promises_1.access)(subPath);
            while (true) {
                subPath = `${basePath}.${counter}`;
                try {
                    await (0, promises_1.access)(subPath);
                    counter++;
                }
                catch (error) {
                    return subPath;
                }
            }
        }
        catch (error) {
            return subPath;
        }
    }
    async _saveSubFile(subFile, text, audioPath, outputType) {
        let subPath = audioPath + '.json';
        if (outputType === 'stream') {
            const tmpDir = audioPath + '_tmp';
            await (0, utils_1.ensureDir)(tmpDir);
            const { base } = (0, path_1.parse)(audioPath);
            audioPath = (0, path_1.resolve)(tmpDir, base);
            subPath = await this.getSrtPath(audioPath);
        }
        let subChars = text.split('');
        let subCharIndex = 0;
        subFile.forEach((cue, index) => {
            let fullPart = '';
            let stepIndex = 0;
            for (let sci = subCharIndex; sci < subChars.length; sci++) {
                if (subChars[sci] === cue.part[stepIndex]) {
                    fullPart = fullPart + subChars[sci];
                    stepIndex += 1;
                }
                else if (subChars[sci] === subFile?.[index + 1]?.part?.[0]) {
                    subCharIndex = sci;
                    break;
                }
                else {
                    fullPart = fullPart + subChars[sci];
                }
            }
            cue.part = fullPart;
        });
        console.log('save subtitles to file: ', subPath);
        await (0, promises_1.writeFile)(subPath, JSON.stringify(subFile, null, '  '), { encoding: 'utf-8' });
    }
    async ttsPromise(text, options = {}) {
        const { outputType = 'buffer', audioPath, saveSubtitles = this.saveSubtitles } = options;
        if (outputType === 'file' && !audioPath) {
            throw new Error('audioPath is required when outputType is "file"');
        }
        let _wsConnect;
        try {
            _wsConnect = await this._connectWebSocket();
        }
        catch (err) {
            throw new Error(`Failed to connect WebSocket: ${err.message}`);
        }
        let audioStream;
        let readableStream;
        let audioChunks = [];
        let subFile = [];
        let isStreamDestroyed = false;
        let resolveBuffer;
        let rejectBuffer;
        let resolveFile;
        let rejectFile;
        // 初始化输出
        if (outputType === 'file') {
            try {
                audioStream = (0, node_fs_1.createWriteStream)(audioPath);
            }
            catch (err) {
                _wsConnect.close();
                throw new Error(`Failed to create write stream: ${err.message}`);
            }
        }
        else if (outputType === 'stream') {
            readableStream = new node_stream_1.Readable({
                read() { },
                destroy(err, callback) {
                    isStreamDestroyed = true;
                    _wsConnect.close();
                    callback(err);
                },
            });
        }
        // 设置超时
        const timeout = setTimeout(() => {
            _wsConnect.close();
            if (readableStream)
                readableStream.destroy(new Error('WebSocket timed out'));
            if (outputType === 'file') {
                audioStream?.end();
                rejectFile?.(new Error('WebSocket timed out'));
            }
            if (outputType === 'buffer')
                rejectBuffer?.(new Error('WebSocket timed out'));
        }, this.timeout);
        // 处理 WebSocket 消息
        _wsConnect.on('message', (data, isBinary) => {
            clearTimeout(timeout);
            if (isBinary) {
                const separator = 'Path:audio\r\n';
                const index = data.indexOf(separator) + separator.length;
                const audioData = data.subarray(index);
                if (outputType === 'file') {
                    try {
                        audioStream.write(audioData);
                    }
                    catch (err) {
                        audioStream.end();
                        _wsConnect.close();
                        throw new Error(`Failed to write to file: ${err.message}`);
                    }
                }
                else if (outputType === 'stream' && !isStreamDestroyed) {
                    readableStream.push(audioData); // 实时推送
                }
                else if (outputType === 'buffer') {
                    audioChunks.push(audioData);
                }
            }
            else {
                const message = data.toString();
                if (message.includes('Path:turn.end')) {
                    if (saveSubtitles)
                        this._saveSubFile(subFile, text, audioPath, outputType);
                    if (outputType === 'file') {
                        audioStream.end();
                        _wsConnect.close();
                        resolveFile();
                    }
                    else if (outputType === 'stream' && !isStreamDestroyed) {
                        readableStream.push(null);
                        console.log(`close edge-tts readableStream...`);
                        _wsConnect.close();
                    }
                    else if (outputType === 'buffer') {
                        const audioBuffer = Buffer.concat(audioChunks);
                        _wsConnect.close();
                        resolveBuffer?.(audioBuffer); // 直接调用 resolve
                    }
                }
                else if (message.includes('Path:audio.metadata')) {
                    const splitTexts = message.split('\r\n');
                    try {
                        const metadata = JSON.parse(splitTexts[splitTexts.length - 1]);
                        metadata['Metadata'].forEach((element) => {
                            subFile.push({
                                part: element['Data']['text']['Text'],
                                start: Math.floor(element['Data']['Offset'] / 10000),
                                end: Math.floor((element['Data']['Offset'] + element['Data']['Duration']) / 10000),
                            });
                        });
                    }
                    catch {
                        // 忽略解析错误
                    }
                }
            }
        });
        // WebSocket 错误处理
        _wsConnect.on('error', (err) => {
            clearTimeout(timeout);
            if (outputType === 'file') {
                audioStream?.end();
                rejectFile?.(new Error(`WebSocket error: ${err.message}`));
            }
            if (outputType === 'stream' && !isStreamDestroyed)
                readableStream?.destroy(err);
            if (outputType === 'buffer')
                rejectBuffer?.(new Error(`WebSocket error: ${err.message}`));
            _wsConnect.close();
        });
        // WebSocket 关闭处理
        _wsConnect.on('close', (code, reason) => {
            clearTimeout(timeout);
            if (code !== 1000) {
                const errMsg = `WebSocket closed unexpectedly with code ${code}: ${reason.toString()}`;
                if (outputType === 'file') {
                    audioStream?.end();
                    rejectFile?.(new Error(errMsg));
                }
                if (outputType === 'stream' && !isStreamDestroyed)
                    readableStream?.destroy(new Error(errMsg));
                if (outputType === 'buffer')
                    rejectBuffer?.(new Error(errMsg));
            }
        });
        // 文件流错误处理
        if (outputType === 'file') {
            audioStream.on('error', (err) => {
                audioStream.end();
                _wsConnect.close();
                throw new Error(`File stream error: ${err.message}`);
            });
        }
        // 发送 SSML 请求
        try {
            const requestId = (0, node_crypto_1.randomBytes)(16).toString('hex');
            _wsConnect.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n
        <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${this.lang}">
          <voice name="${this.voice}">
            <prosody rate="${this.rate}" pitch="${this.pitch}" volume="${this.volume}">
              ${(0, utils_1.escapeSSML)(text)}
            </prosody>
          </voice>
        </speak>`);
        }
        catch (err) {
            _wsConnect.close();
            if (readableStream)
                readableStream.destroy(err);
            throw new Error(`Failed to send SSML request: ${err.message}`);
        }
        // 立即返回
        if (outputType === 'stream') {
            return readableStream;
        }
        else if (outputType === 'buffer') {
            return new Promise((resolve, reject) => {
                resolveBuffer = resolve;
                rejectBuffer = reject;
            });
        }
        else if (outputType === 'file') {
            return new Promise((resolve, reject) => {
                resolveFile = resolve;
                rejectFile = reject;
            });
        }
        else {
            throw new Error(`Invalid output type: ${outputType}`);
        }
    }
}
exports.EdgeTTS = EdgeTTS;
//# sourceMappingURL=edge-tts-fixed.js.map