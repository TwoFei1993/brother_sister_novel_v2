"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateJson = exports.validateLLM = exports.validateEdge = exports.llmSchema = exports.edgeSchema = void 0;
const index_1 = require("./../config/index");
const zod_1 = require("zod");
const logger_1 = require("../utils/logger");
const openai_1 = require("../utils/openai");
exports.edgeSchema = zod_1.z.object({
    text: zod_1.z.string().trim().min(5, { message: '文本最少 5 字符！' }),
    voice: zod_1.z.string().min(1),
    pitch: zod_1.z.string().optional(),
    volume: zod_1.z.string().optional(),
    rate: zod_1.z.string().optional(),
    useLLM: zod_1.z.boolean().default(false),
});
exports.llmSchema = zod_1.z.object({
    text: zod_1.z.string().trim().min(5, { message: '文本最少 5 字符！' }),
    openaiBaseUrl: zod_1.z.preprocess((val) => val ?? '', zod_1.z.string().trim().url({ message: '请输入有效的 OpenAI API URL！' })),
    openaiKey: zod_1.z.preprocess((val) => val ?? '', zod_1.z.string().trim().min(1, { message: '请在环境变量设置或前端传入 openaiKey！' })),
    openaiModel: zod_1.z.preprocess((val) => val ?? '', zod_1.z.string().trim().min(1, { message: '请在环境变量设置或前端传入 openaiModel 模型名称！' })),
    useLLM: zod_1.z.boolean().default(true),
});
const dataItemSchema = zod_1.z.object({
    text: zod_1.z.string().min(1, '文本内容不能为空'),
    voice: zod_1.z.string().min(1, '语音类型不能为空'),
    rate: zod_1.z.string().default(''),
    pitch: zod_1.z.string().default(''),
    volume: zod_1.z.string().default(''),
});
const jsonSchema = zod_1.z.object({
    data: zod_1.z.array(dataItemSchema).min(1, '数据数组不能为空'),
});
const commonValidate = (req, res, next, schema) => {
    try {
        schema.parse(req.body);
        openai_1.openai.config({
            apiKey: req.body.openaiKey,
            baseURL: req.body.openaiBaseUrl,
            model: req.body.openaiModel,
        });
        if (index_1.LIMIT_TEXT_LENGTH) {
            const allTxt = req.body.text;
            if (allTxt?.length > index_1.LIMIT_TEXT_LENGTH) {
                res.status(400).json({
                    code: 400,
                    message: index_1.LIMIT_TEXT_LENGTH_ERROR_MESSAGE || `文本内容不能超出 ${index_1.LIMIT_TEXT_LENGTH} 字符哦！`,
                    success: false,
                });
                return;
            }
        }
        next();
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            res.status(400).json({ code: 400, errors: error.errors, success: false });
            return;
        }
        res.status(500).json({ code: 500, message: 'Internal server error' });
        return;
    }
};
const validateEdge = (req, res, next) => {
    const body = req.body;
    const isGenerate = req.url.includes('/generate');
    logger_1.logger.info(`validateEdge`, body, req.url);
    if (isGenerate && body.text?.length > index_1.DIRECT_GEN_LIMIT) {
        res.status(400).json({
            code: 400,
            errors: [{ message: `文本长度不能超过 ${index_1.DIRECT_GEN_LIMIT} 个字符，长文本请用流式接口`, path: ['text'] }],
            success: false,
        });
        return;
    }
    commonValidate(req, res, next, exports.edgeSchema);
};
exports.validateEdge = validateEdge;
const validateLLM = (req, res, next) => {
    const { useLLM, text } = req.body;
    const isGenerate = req.url.includes('/generate');
    logger_1.logger.info(`validateLLM`, useLLM, req.url);
    if (isGenerate && useLLM && text?.length > index_1.DIRECT_GEN_LIMIT) {
        res.status(400).json({
            code: 400,
            errors: [{ message: `文本长度不能超过 ${index_1.DIRECT_GEN_LIMIT} 个字符，长文本请用流式接口`, path: ['text'] }],
            success: false,
        });
        return;
    }
    // read from env if not provided in request body
    const { OPENAI_BASE_URL, OPENAI_API_KEY, MODEL_NAME } = process.env;
    if (!req.body?.openaiBaseUrl && OPENAI_BASE_URL) {
        req.body.openaiBaseUrl = OPENAI_BASE_URL;
    }
    if (!req.body?.openaiKey && OPENAI_API_KEY) {
        req.body.openaiKey = OPENAI_API_KEY;
    }
    if (!req.body?.openaiModel && MODEL_NAME) {
        req.body.openaiModel = MODEL_NAME;
    }
    commonValidate(req, res, next, exports.llmSchema);
};
exports.validateLLM = validateLLM;
const validateJson = (req, res, next) => {
    try {
        jsonSchema.parse(req.body);
        if (index_1.LIMIT_TEXT_LENGTH) {
            const allTxt = req.body.data.map((item) => item.text).join('');
            if (allTxt?.length > index_1.LIMIT_TEXT_LENGTH) {
                res.status(400).json({
                    code: 400,
                    message: index_1.LIMIT_TEXT_LENGTH_ERROR_MESSAGE || `文本内容不能超出 ${index_1.LIMIT_TEXT_LENGTH} 字符哦！`,
                    success: false,
                });
                return;
            }
        }
        next();
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            res.status(400).json({ code: 400, errors: error.errors, success: false });
            return;
        }
        res.status(500).json({ code: 500, message: 'Internal server error' });
        return;
    }
};
exports.validateJson = validateJson;
//# sourceMappingURL=generate.js.map