/**
 * 腾讯云 SCF 入口文件
 */
import { Application } from 'express';
import { createApp } from './app';
import { AUDIO_DIR, PUBLIC_DIR, RATE_LIMIT, RATE_LIMIT_WINDOW, PORT } from './config';
import { ttsPluginManager } from './tts/pluginManager';

let app: Application | undefined;

/**
 * 初始化应用
 */
async function init(): Promise<Application> {
  if (!app) {
    app = createApp({
      isDev: process.env.NODE_ENV === 'development',
      rateLimit: RATE_LIMIT,
      rateLimitWindow: RATE_LIMIT_WINDOW,
      audioDir: AUDIO_DIR,
      publicDir: PUBLIC_DIR,
    }) as Application;
    await ttsPluginManager.initializeEngines();
  }
  return app;
}

/**
 * 云函数入口 - SCF 会调用这个函数
 */
export async function main_handler(event: any, context: any): Promise<any> {
  // 等待应用初始化
  const expressApp = await init();

  // 返回 Express app 用于 SCF
  return expressApp(event, context);
}
