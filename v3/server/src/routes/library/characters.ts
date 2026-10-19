/**
 * 角色卡资产路由（设计 §4.1 characters/<id>.json，Task 6）
 * 壳层 strict（id/name/avatar/card），card 为酒馆 V2 原生格式（passthrough 保字段）。
 * POST 按 name 幂等：同名返回既有资产（200）——批量导入失败重试不产生重复卡。
 */
import type { CharacterAsset } from '@shared/card';
import { CharacterAssetSchema } from '@shared/card';

import { crudRouter, libraryDir } from './crud';

export const charactersRouter = crudRouter<CharacterAsset>({
  dirOf: () => libraryDir('characters'),
  schema: CharacterAssetSchema,
  label: '角色卡',
  idempotentByName: true,
});
