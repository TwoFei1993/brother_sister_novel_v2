// 数据目录解析（设计 §4.1）：路由层每次请求实时读 env DATA_DIR，
// 与 auth 中间件"实时读 env"约定一致（测试 beforeEach 设定即可覆盖，无需 mock）。
// 默认值与 main.ts 的解析规则保持一致：相对路径以 server/ 为基准。

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// paths.ts 位于 src/routes/core/，上三级即 server/（与 library/crud.ts 同基准）
const SERVER_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** 当前数据根目录（绝对路径 env 直接生效；未设置时回退 server/../data） */
export function dataDir(): string {
  return resolve(SERVER_ROOT, process.env.DATA_DIR ?? '../data');
}
