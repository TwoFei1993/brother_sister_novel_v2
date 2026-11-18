/**
 * 物品道具资产路由（用户需求：特殊物品道具资料卡）：复用 CRUD 工厂，items/<id>.json
 */
import type { ItemAsset } from '@shared/assets/item';
import { ItemAssetSchema } from '@shared/assets/item';

import { crudRouter, libraryDir } from './crud';

export const itemsRouter = crudRouter<ItemAsset>({
  dirOf: () => libraryDir('items'),
  schema: ItemAssetSchema,
  label: '物品道具',
});
