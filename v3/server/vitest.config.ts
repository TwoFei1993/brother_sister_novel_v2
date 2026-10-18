// @v3/server 测试配置：node 环境、无 setup。
// 必须显式声明，否则 vitest 会向上查找到旧站根目录的 vitest.config.ts
// （其 setupFiles 指向不存在的文件导致误报失败）。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
