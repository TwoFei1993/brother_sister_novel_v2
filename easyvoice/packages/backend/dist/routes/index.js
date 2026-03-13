"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupRoutes = setupRoutes;
const tts_route_1 = __importDefault(require("./tts.route"));
const connect_history_api_fallback_1 = __importDefault(require("connect-history-api-fallback"));
const health_middleware_1 = require("../middleware/health.middleware");
function setupRoutes(app) {
    app.use('/api/v1/tts', tts_route_1.default);
    app.use('/api/health', health_middleware_1.healthHandler);
    app.use((0, connect_history_api_fallback_1.default)());
}
//# sourceMappingURL=index.js.map