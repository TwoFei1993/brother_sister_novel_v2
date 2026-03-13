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
Object.defineProperty(exports, "__esModule", { value: true });
const franc_min_1 = require("franc-min");
const jieba_1 = require("@node-rs/jieba");
const natural = __importStar(require("natural"));
const nodejieba = new jieba_1.Jieba();
// 定义语言特定的句子分隔符
const sentenceSeparators = {
    zho: /[。！？；]/, // 中文
    eng: /[.!?]/, // 英文
    default: /[.!?。！？；]/,
};
function splitTextBySemantics(text, minLength = 100, maxLength = 200) {
    const result = [];
    // 检测语言
    const detectedLang = (0, franc_min_1.franc)(text, { minLength: 10 }) || 'und';
    const separator = sentenceSeparators[detectedLang] || sentenceSeparators['default'];
    const isEng = detectedLang === 'eng';
    const isZH = detectedLang === 'cmn' || detectedLang === 'zho' || detectedLang === 'zh';
    console.log(`detectedLang:`, detectedLang);
    if (isZH) {
        minLength = 200;
        maxLength = 400;
    }
    if (isEng) {
        minLength *= 2;
        maxLength *= 2;
    }
    // 按段落分割
    const paragraphs = text.split('\n').filter((p) => p.trim().length > 0);
    let currentChunk = '';
    console.log(paragraphs);
    for (const paragraph of paragraphs) {
        if (paragraph.length > maxLength) {
            const sentences = detectedLang === 'zho' || detectedLang === 'cmn'
                ? splitChineseSentences(paragraph, maxLength)
                : splitEnglishSentences(paragraph, maxLength);
            for (const sentenceChunk of sentences) {
                if (currentChunk.length + sentenceChunk.length <= maxLength) {
                    currentChunk += (currentChunk ? '\n' : '') + sentenceChunk;
                }
                else {
                    if (currentChunk)
                        result.push(currentChunk);
                    currentChunk = sentenceChunk;
                }
            }
        }
        else {
            if (currentChunk.length + paragraph.length <= maxLength) {
                currentChunk += (currentChunk ? '\n' : '') + paragraph;
            }
            else {
                if (currentChunk)
                    result.push(currentChunk);
                currentChunk = paragraph;
            }
        }
    }
    if (currentChunk)
        result.push(currentChunk);
    return mergeShortChunks(result, minLength);
}
function splitChineseSentences(text, maxLength) {
    const chunks = [];
    let current = '';
    // 使用 nodejieba 切分词并检测句子边界
    const words = nodejieba.cut(text);
    for (const word of words) {
        current += word;
        if (/[。！？；]/.test(word) && current.length >= maxLength) {
            chunks.push(current);
            current = '';
        }
    }
    if (current)
        chunks.push(current);
    return chunks;
}
function splitEnglishSentences(text, maxLength) {
    const abbreviations = ['Mr.', 'Mrs.', 'Dr.', 'Inc.'];
    const demarkers = ['.', '!', '?'];
    const tokenizer = new natural.SentenceTokenizer(abbreviations, demarkers);
    const sentences = tokenizer.tokenize(text);
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
        if (current.length + sentence.length <= maxLength) {
            current += (current ? ' ' : '') + sentence;
        }
        else {
            if (current)
                chunks.push(current);
            current = sentence;
        }
    }
    if (current)
        chunks.push(current);
    return chunks;
}
function mergeShortChunks(chunks, minLength) {
    const merged = [];
    let current = '';
    for (const chunk of chunks) {
        if (current.length < minLength && current.length + chunk.length <= 500) {
            current += (current ? '\n' : '') + chunk;
        }
        else {
            if (current)
                merged.push(current);
            current = chunk;
        }
    }
    if (current)
        merged.push(current);
    return merged;
}
if (require.main === module) {
    // 测试代码
    const longText = `这是一个很长的段落，包含了很多内容。我们需要把它分割成适当的大小。接下来的句子会更长一些，因为我想测试超过500字符的情况是什么样的。以下是一个新的段落。

这个段落也很长，里面有很多信息需要处理，比如说如何在Node.js中优雅地实现文本分割。我们希望结果既符合语义，又满足长度要求。这个段落也很长，里面有很多信息需要处理，比如说如何在Node.js中优雅地实现文本分割。我们希望结果既符合语义，又满足长度要求。这个段落也很长，里面有很多信息需要处理，比如说如何在Node.js中优雅地实现文本分割。我们希望结果既符合语义，又满足长度要求。这个段落也很长，里面有很多信息需要处理，比如说如何在Node.js中优雅地实现文本分割。我们希望结果既符合语义，又满足长度要求。这个段落也很长，里面有很多信息需要处理，比如说如何在Node.js中优雅地实现文本分割。我们希望结果既符合语义，又满足长度要求。这个段落也很长，里面有很多信息需要处理，比如说如何在Node.js中优雅地实现文本分割。我们希望结果既符合语义，又满足长度要求。这个段落也很长，里面有很多信息需要处理，比如说如何在Node.js中优雅地实现文本分割。我们希望结果既符合语义，又满足长度要求。

This is an English paragraph. It has multiple sentences and might need splitting too. Let's see how it works!
`;
    const chunks = splitTextBySemantics(longText);
    chunks.forEach((chunk, index) => {
        console.log(`Chunk ${index + 1} (${chunk.length} chars): ${chunk}`);
    });
}
//# sourceMappingURL=spliter.js.map