"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickSchema = void 0;
const generate_1 = require("../schema/generate");
const pickSchema = (req, res, next) => {
    const { useLLM } = req.body;
    if (useLLM) {
        (0, generate_1.validateLLM)(req, res, next);
    }
    else {
        (0, generate_1.validateEdge)(req, res, next);
    }
};
exports.pickSchema = pickSchema;
//# sourceMappingURL=pick.controller.js.map