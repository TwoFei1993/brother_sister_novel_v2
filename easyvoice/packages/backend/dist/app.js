"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const logger_1 = require("./utils/logger");
const config_1 = require("./middleware/config");
const static_1 = require("./middleware/static");
const routes_1 = require("./routes");
const engines_1 = require("./tts/engines");
const error_middleware_1 = require("./middleware/error.middleware");
// 创建应用工厂函数
function createApp(config) {
    const { isDev, rateLimit, rateLimitWindow, audioDir, publicDir } = config;
    logger_1.logger.debug('Initializing application...');
    const app = (0, express_1.default)();
    // 配置中间件
    const middleware = (0, config_1.createMiddlewareConfig)({
        isDev,
        rateLimit,
        rateLimitWindow,
    });
    // 应用中间件
    Object.values(middleware).forEach((mw) => app.use(mw));
    // 配置路由
    (0, routes_1.setupRoutes)(app);
    // 配置静态文件服务
    (0, static_1.configureStaticFiles)(app, { audioDir, publicDir });
    (0, engines_1.registerEngines)();
    app.use(error_middleware_1.errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map