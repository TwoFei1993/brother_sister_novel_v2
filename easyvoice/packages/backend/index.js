/**
 * 腾讯云 SCF Web 函数入口
 */
const { createApp } = require('./app');
const { AUDIO_DIR, PUBLIC_DIR, RATE_LIMIT, RATE_LIMIT_WINDOW } = require('./config');
const { ttsPluginManager } = require('./tts/pluginManager');

async function start() {
  const app = createApp({
    isDev: false,
    rateLimit: RATE_LIMIT,
    rateLimitWindow: RATE_LIMIT_WINDOW,
    audioDir: AUDIO_DIR,
    publicDir: PUBLIC_DIR,
  });

  await ttsPluginManager.initializeEngines();

  const port = process.env.PORT || 9000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
}

start().catch(console.error);
