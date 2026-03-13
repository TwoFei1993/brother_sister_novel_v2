"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureStaticFiles = configureStaticFiles;
const express_1 = __importDefault(require("express"));
function configureStaticFiles(app, { audioDir, publicDir }) {
    app.use(express_1.default.static(audioDir));
    app.use(express_1.default.static(publicDir));
}
//# sourceMappingURL=static.js.map