/**
 * 预设资产路由（设计 §4.1 presets/<id>.json，Task 6）
 * 壳层 strict（id/name/raw），raw 为酒馆预设原生格式（passthrough 保字段）。
 */
import type { PresetAsset } from '@shared/preset';
import { PresetAssetSchema } from '@shared/preset';

import { crudRouter, libraryDir } from './crud';

export const presetsRouter = crudRouter<PresetAsset>({
  dirOf: () => libraryDir('presets'),
  schema: PresetAssetSchema,
  label: '预设',
  // 浅列表带 tags：书的「写作风格与预设」区按 tag 推荐/常显（通用），无需拉全量 raw
  extraListFields: (a) => ({ tags: a.tags ?? [] }),
});
