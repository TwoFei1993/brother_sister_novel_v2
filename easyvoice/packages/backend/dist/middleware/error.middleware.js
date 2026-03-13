"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const logger_1 = require("../utils/logger");
const tts_service_1 = require("../services/tts.service");
function errorHandler(err, req, res, next) {
    const errorDetails = {
        name: err.name,
        message: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString(),
        request: {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: req.body,
            query: req.query,
            params: req.params,
            ip: req.ip,
        },
    };
    logger_1.logger.error('Error occurred:', {
        ...errorDetails,
        request: {
            ...errorDetails.request,
            body: {
                ...errorDetails.request.body,
                password: undefined,
                authorization: undefined,
            },
        },
    });
    const code = getCode(err.message);
    res.status(code).json({
        success: false,
        message: err.message,
        ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
    });
}
function getCode(message) {
    console.log(`message, ErrorMessages.ENG_MODEL_INVALID_TEXT`);
    console.log(message, tts_service_1.ErrorMessages.ENG_MODEL_INVALID_TEXT);
    if (message.includes(tts_service_1.ErrorMessages.ENG_MODEL_INVALID_TEXT))
        return 400;
    return 500;
}
//# sourceMappingURL=error.middleware.js.map