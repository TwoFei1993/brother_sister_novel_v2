"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitText = splitText;
const jieba_1 = require("@node-rs/jieba");
const jieba = new jieba_1.Jieba();
const TARGET_LENGTH = 500;
function splitText(text, targetLength = TARGET_LENGTH) {
    if (text.length < targetLength)
        return { length: 1, segments: [text] };
    const segments = [];
    let currentSegment = '';
    let sentences = text.split(/([。！？.!?])/);
    for (let i = 0; i < sentences.length; i += 2) {
        const sentence = (sentences[i] || '') + (sentences[i + 1] || '');
        if (!sentence.trim())
            continue;
        if ((currentSegment + sentence).length <= targetLength) {
            currentSegment += sentence;
        }
        else {
            if (currentSegment) {
                segments.push(currentSegment.trim());
            }
            currentSegment = sentence;
        }
    }
    if (currentSegment) {
        segments.push(currentSegment.trim());
    }
    const finalSegments = [];
    for (let segment of segments) {
        if (segment.length <= targetLength) {
            finalSegments.push(segment);
        }
        else {
            const words = jieba.cut(segment);
            let subSegment = '';
            for (let word of words) {
                if ((subSegment + word).length <= targetLength) {
                    subSegment += word;
                }
                else {
                    finalSegments.push(subSegment);
                    subSegment = word;
                }
            }
            if (subSegment)
                finalSegments.push(subSegment);
        }
    }
    return { length: finalSegments.length, segments: finalSegments };
}
//# sourceMappingURL=text.service.js.map