"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetcher = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("./logger");
const instance = axios_1.default.create({
    baseURL: process.env.API_URL || 'http://localhost:3000/api',
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
});
instance.interceptors.request.use((config) => {
    // 添加token认证
    const token = process.env.JWT_TOKEN || ''; // 假设从环境变量获取token
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    logger_1.logger.info(`Request started: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
}, (error) => {
    logger_1.logger.error('Request interceptor error:', error);
    return Promise.reject(error);
});
instance.interceptors.response.use((response) => {
    const { data } = response;
    if (response.status !== 200) {
        if (response.status === 401) {
            logger_1.logger.warn('Unauthorized request, redirecting to login');
            return Promise.reject(new Error('Unauthorized'));
        }
        return Promise.reject(new Error(data.message || 'Request failed'));
    }
    logger_1.logger.info(`Request succeeded: ${response.config.url}`);
    return response;
}, (error) => {
    const config = error.config;
    const url = config.url || 'unknown URL';
    if (error.response) {
        const { status } = error.response;
        if (status === 403) {
            logger_1.logger.warn(`Forbidden access: ${url}`);
        }
        else if (status === 500) {
            logger_1.logger.error(`Server error: ${url}`);
        }
    }
    else if (error.code === 'ECONNABORTED') {
        logger_1.logger.error(`Request timeout: ${url}`);
    }
    else {
        logger_1.logger.error(`Network error: ${url}`, { error: error.message });
    }
    return Promise.reject(error);
});
const _request = async (config) => {
    try {
        const response = await instance(config);
        return response;
    }
    catch (error) {
        const logError = config.logError ?? true;
        if (logError) {
            logger_1.logger.error(`Request failed: ${config.url || 'unknown URL'}`, {
                method: config.method,
                error: error.message,
            });
        }
        throw error;
    }
};
exports.fetcher = {
    get: (url, params, config) => _request({
        url,
        method: 'GET',
        params,
        ...config,
    }),
    post: (url, data, config) => _request({
        url,
        method: 'POST',
        data,
        ...config,
    }),
    put: (url, data, config) => _request({
        url,
        method: 'PUT',
        data,
        ...config,
    }),
    delete: (url, params, config) => _request({
        url,
        method: 'DELETE',
        params,
        ...config,
    }),
};
//# sourceMappingURL=request.js.map