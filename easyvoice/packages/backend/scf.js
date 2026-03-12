/**
 * 腾讯云 SCF 入口文件 - 已为 SCF 优化
 */
const { createApp } = require('./app');
const { AUDIO_DIR, PUBLIC_DIR, RATE_LIMIT, RATE_LIMIT_WINDOW } = require('./config');
const { ttsPluginManager } = require('./tts/pluginManager');

let app;
let initialized = false;

async function init() {
  if (!initialized) {
    app = createApp({
      isDev: false,
      rateLimit: RATE_LIMIT,
      rateLimitWindow: RATE_LIMIT_WINDOW,
      audioDir: AUDIO_DIR,
      publicDir: PUBLIC_DIR,
    });
    await ttsPluginManager.initializeEngines();
    initialized = true;
    console.log('App initialized');
  }
  return app;
}

/**
 * SCF 入口函数
 */
exports.main_handler = async (event, context) => {
  try {
    await init();

    // SCF 传递的是 API Gateway 事件
    // 需要模拟 req/res 给 Express
    const http = require('http');

    return new Promise((resolve, reject) => {
      const query = event.queryString || {};
      const path = event.path || '/';
      const method = event.httpMethod || 'GET';
      const headers = event.headers || {};
      const body = event.body || '';

      // 创建模拟请求
      const req = {
        method,
        url: path + (Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : ''),
        path,
        query,
        headers,
        body,
        protocol: 'https',
        get: (name) => headers[name.toLowerCase()]
      };

      // 创建模拟响应
      let statusCode = 200;
      let responseBody = '';
      const res = {
        statusCode: (code) => {
          statusCode = code;
          return res;
        },
        setHeader: () => res,
        end: (body) => {
          responseBody = body;
        }
      };

      // 调用 Express app
      app(req, res);

      // 返回结果
      resolve({
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: responseBody
      });
    });
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
