"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthHandler = healthHandler;
const logger_1 = require("../utils/logger");
function healthHandler(req, res) {
    try {
        // await db.ping();
        const extraInfo = {
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            memory: process.memoryUsage(),
        };
        logger_1.logger.debug(`Health check: `, extraInfo);
        res.status(200).json({
            status: 'ok',
        });
    }
    catch (error) {
        // 类型断言或类型检查来处理 unknown
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        res.status(503).json({
            status: 'error',
            message: 'Health check failed',
            error: errorMessage,
        });
    }
}
//# sourceMappingURL=health.middleware.js.map