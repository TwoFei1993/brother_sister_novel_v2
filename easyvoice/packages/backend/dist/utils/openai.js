"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openai = void 0;
exports.createOpenAIClient = createOpenAIClient;
const axios_1 = require("axios");
const config_1 = require("../config");
const logger_1 = require("./logger");
const request_1 = require("./request");
/**
 * 创建 OpenAI 客户端实例
 * @returns OpenAI 工具函数集合
 */
function createOpenAIClient() {
    // 默认配置
    let currentConfig = {
        baseURL: config_1.OPENAI_BASE_URL,
        model: config_1.MODEL_NAME,
        timeout: 60000,
        apiKey: config_1.OPENAI_API_KEY,
    };
    logger_1.logger.debug(`init openai with: `, {
        ...currentConfig,
        apiKey: currentConfig?.apiKey ? currentConfig?.apiKey?.slice(0, 10) + '***' : undefined,
    });
    // 设置 headers
    const getHeaders = () => ({
        Authorization: `Bearer ${currentConfig.apiKey}`,
        'Content-Type': 'application/json',
    });
    /**
     * 创建 Chat Completion
     * @param request 请求参数
     * @param customConfig 自定义配置，可覆盖默认配置
     */
    async function createChatCompletion(request, customConfig) {
        try {
            const mergedConfig = {
                ...currentConfig,
                ...customConfig,
            };
            const response = await request_1.fetcher.post(`${mergedConfig.baseURL}${mergedConfig.baseURL?.endsWith('/') ? '' : '/'}chat/completions`, {
                model: request.model || mergedConfig.model,
                temperature: request.temperature ?? 1.0,
                max_tokens: request.max_tokens,
                top_p: request.top_p ?? 1.0,
                stream: request.stream ?? false,
                ...request,
            }, {
                headers: getHeaders(),
                timeout: mergedConfig.timeout,
            });
            return response.data;
        }
        catch (error) {
            console.log(error);
            if (error instanceof axios_1.AxiosError) {
                console.log(`createChatCompletion`, error.response?.data?.error);
            }
            throw new Error(`Chat completion request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * 获取可用模型列表
     */
    async function getModels() {
        try {
            const response = await request_1.fetcher.get(`${currentConfig.baseURL}/models`, {}, {
                headers: getHeaders(),
                timeout: currentConfig.timeout,
            });
            return response.data;
        }
        catch (error) {
            throw new Error(`Get models failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * 动态更新配置
     * @param newConfig 新的配置参数
     */
    function config(newConfig) {
        currentConfig = {
            ...currentConfig,
            ...newConfig,
        };
        logger_1.logger.debug(`openai currentConfig:`, currentConfig);
    }
    return {
        createChatCompletion,
        getModels,
        config,
    };
}
exports.openai = createOpenAIClient();
//# sourceMappingURL=openai.js.map