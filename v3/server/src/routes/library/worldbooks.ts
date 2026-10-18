/**
 * 世界书资产路由（设计 §4.1 worldbooks/<id>.json，Task 6）
 * 壳层 strict（id/name/raw），raw 为酒馆世界书原生格式（passthrough 保字段）。
 */
import type { WorldbookAsset } from '@shared/worldbook';
import { WorldbookAssetSchema } from '@shared/worldbook';

import { crudRouter, libraryDir } from './crud';

export const worldbooksRouter = crudRouter<WorldbookAsset>({
  dirOf: () => libraryDir('worldbooks'),
  schema: WorldbookAssetSchema,
  label: '世界书',
});
