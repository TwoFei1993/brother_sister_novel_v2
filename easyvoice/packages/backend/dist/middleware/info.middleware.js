"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLoggerMiddleware = void 0;
const express_winston_1 = __importDefault(require("express-winston"));
const logger_1 = require("../utils/logger");
exports.requestLoggerMiddleware = express_winston_1.default.logger({
    winstonInstance: logger_1.logger,
    meta: false, // 记录请求/响应的详细元数据
    msg: 'HTTP {{req.method}} {{req.url}}', // 日志消息模板
    expressFormat: true, // 使用类似 Morgan 的格式
    colorize: false, // 控制台是否启用颜色（JSON 不需要）
    dynamicMeta: (req, res) => {
        // 可选：动态添加元数据
        return {
            ip: req.ip,
            // userAgent: req.headers["user-agent"],
        };
    },
});
//# sourceMappingURL=info.middleware.js.map