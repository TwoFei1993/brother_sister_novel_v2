"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMiddlewareConfig = createMiddlewareConfig;
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = require("express-rate-limit");
const express_1 = __importDefault(require("express"));
const info_middleware_1 = require("./info.middleware");
const config_1 = require("../config");
function createMiddlewareConfig({ isDev, rateLimit, rateLimitWindow }) {
    const useLimiter = (0, express_rate_limit_1.rateLimit)({
        windowMs: rateLimitWindow * 60 * 1000,
        limit: isDev ? 1e6 : rateLimit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
    });
    const useHelmet = (0, helmet_1.default)({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    'https://www.google-analytics.com',
                    'https://www.googletagmanager.com',
                ],
                imgSrc: ["'self'", 'https://www.google-analytics.com', 'data:', 'blob:'],
                connectSrc: ["'self'", 'https://www.google-analytics.com'],
                mediaSrc: ["'self'", 'data:', 'blob:'],
            },
        },
    });
    const pass = (_req, _res, next) => next();
    return {
        cors: (0, cors_1.default)(),
        json: express_1.default.json({ limit: '20mb' }),
        requestLogger: info_middleware_1.requestLoggerMiddleware,
        helmet: config_1.USE_HELMET ? useHelmet : pass,
        limiter: config_1.USE_LIMIT ? useLimiter : pass,
    };
}
//# sourceMappingURL=config.js.map