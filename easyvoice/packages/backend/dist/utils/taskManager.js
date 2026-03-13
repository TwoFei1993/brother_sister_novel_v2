"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const process_1 = require("process");
const _1 = require(".");
const logger_1 = require("./logger");
class TaskManager {
    constructor(options) {
        this.tasks = new Map();
        this.MAX_TASKS = options?.length || 10;
    }
    generateTaskId(fields, options = {}) {
        const { prefix = 'task', length = 32 } = options;
        const hash = crypto_1.default.createHash('md5');
        Object.keys(fields)
            .sort()
            .forEach((key) => {
            const value = fields[key];
            if (!value)
                return;
            hash.update(key);
            if (typeof value === 'string' && value.length > 1000) {
                for (let i = 0; i < value.length; i += 1000) {
                    hash.update(value.slice(i, i + 1000));
                }
            }
            else {
                hash.update(JSON.stringify(value));
            }
        });
        const hashValue = hash.digest('hex');
        return `${prefix}${hashValue.slice(0, length)}`;
    }
    createTask(fields, options) {
        const taskId = this.generateTaskId(fields, options);
        if (this.isTaskPending(taskId)) {
            throw new Error(`task: ${taskId} already exists!`);
        }
        if (this.getPendingTasks()?.length >= this.MAX_TASKS) {
            throw new Error(`Cannot create more than ${this.MAX_TASKS} tasks!`);
        }
        const task = {
            id: taskId,
            fields,
            status: 'pending',
            progress: 0,
            message: '',
            result: null,
            createdAt: new Date(),
            updateProgress: this.updateProgress.bind(this),
            endTask: this.finishTask.bind(this),
        };
        this.tasks.set(taskId, task);
        return task;
    }
    finishTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            throw new Error(`Cannot find task: ${taskId}`);
        task.status = 'completed';
        task.progress = 100;
        task.updatedAt = new Date();
        this.tasks.set(taskId, task);
        logger_1.logger.info(`Task ${taskId} completed`);
        return task;
    }
    isTaskPending(taskId) {
        return this.getTask(taskId)?.status === 'pending' || false;
    }
    getTask(taskId) {
        return this.tasks.get(taskId) || null;
    }
    failTask(taskId, { code, message }) {
        const findTask = this.getTask(taskId);
        if (!findTask) {
            throw new Error(`Cannot find task: ${taskId}`);
        }
        findTask.status = 'failed';
        findTask.message = message;
        findTask.code = code;
        findTask.updatedAt = new Date();
        this.tasks.set(taskId, findTask);
        return true;
    }
    updateProgress(taskId, progress) {
        const findTask = this.getTask(taskId);
        if (!findTask)
            return;
        findTask.progress = progress;
        findTask.updatedAt = new Date();
        this.tasks.set(taskId, findTask);
        return findTask;
    }
    updateTask(taskId, { status = 'completed', progress = 100, result, }) {
        const findTask = this.getTask(taskId);
        if (!findTask) {
            throw new Error(`Cannot find task: ${taskId}`);
        }
        findTask.status = status;
        findTask.updatedAt = new Date();
        findTask.progress = progress;
        findTask.result = result;
        this.tasks.set(taskId, findTask);
        return findTask;
    }
    getTaskLength() {
        return this.tasks.size;
    }
    getPendingTasks() {
        return Array.from(this.tasks.values()).filter((task) => task.status === 'pending');
    }
    getTaskStats() {
        const tasks = Array.from(this.tasks.values());
        const memory = {
            heapUsed: (0, _1.formatFileSize)((0, process_1.memoryUsage)().heapUsed),
            heapTotal: (0, _1.formatFileSize)((0, process_1.memoryUsage)().heapTotal),
            rss: (0, _1.formatFileSize)((0, process_1.memoryUsage)().rss),
        };
        const stats = {
            totalTasks: this.getTaskLength(),
            completedTasks: tasks.filter((task) => task.status === 'completed').length,
            failedTasks: tasks.filter((task) => task.status === 'failed').length,
            pendingTasks: tasks.filter((task) => task.status === 'pending').length,
            memory,
        };
        return stats;
    }
}
const instance = new TaskManager();
exports.default = instance;
//# sourceMappingURL=taskManager.js.map