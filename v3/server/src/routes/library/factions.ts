/**
 * 势力介绍资产路由（安卓 app Phase2）：复用 CRUD 工厂，factions/<id>.json
 */
import type { FactionAsset } from '@shared/assets/faction';
import { FactionAssetSchema } from '@shared/assets/faction';

import { crudRouter, libraryDir } from './crud';

export const factionsRouter = crudRouter<FactionAsset>({
  dirOf: () => libraryDir('factions'),
  schema: FactionAssetSchema,
  label: '势力介绍',
});
