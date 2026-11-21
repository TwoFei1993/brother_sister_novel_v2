// @v3/shared 测试配置：node 环境、无 setup。
// 必须显式声明，否则 vitest 会向上查找到旧站根目录的 vitest.config.ts
// （其 setupFiles 指向不存在的文件导致误报失败）。
// resolve.alias：vitest 不读 tsconfig paths，手动映射 @shared/* 到本包源码
// （与 tsconfig.base.json 的 paths 保持一致；tsc 走 paths，vitest 走这里——
//   engine/lib 纯内核下沉后，shared 内部同样以 @shared/* 自引用）。
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
