/**
 * 腾讯云 SCF 入口文件
 */
const { createApp } = require('./app');
const { AUDIO_DIR, PUBLIC_DIR, RATE_LIMIT, RATE_LIMIT_WINDOW, PORT } = require('./config');
const { ttsPluginManager } = require('./tts/pluginManager');

let app;

/**
 * 初始化应用
 */
async function init() {
  if (!app) {
    app = createApp({
      isDev: process.env.NODE_ENV === 'development',
      rateLimit: RATE_LIMIT,
      rateLimitWindow: RATE_LIMIT_WINDOW,
      audioDir: AUDIO_DIR,
      publicDir: PUBLIC_DIR,
    });
    await ttsPluginManager.initializeEngines();
  }
  return app;
}

/**
 * 云函数入口 - SCF 会调用这个函数
 */
exports.main_handler = async (event, context) => {
  // 等待应用初始化
  await init();

  // 返回 Express app 用于 SCF
  return app(event, context);
};
