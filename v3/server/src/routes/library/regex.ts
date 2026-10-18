/**
 * 正则脚本资产路由（设计 §4.1 regex-scripts/<id>.json，Task 6）
 * 壳层 strict（id/name/raw），raw 为酒馆正则脚本原生格式（passthrough 保字段）。
 * shared 暂无 RegexAsset 壳类型，本地定义；客户端需要时再上移 @shared。
 */
import { z } from 'zod';
import { TavernRegexScriptSchema } from '@shared/tavern';

import { crudRouter, libraryDir } from './crud';

export const RegexAssetSchema = z.strictObject({
  id: z.string().min(1),
  /** 列表展示名 */
  name: z.string(),
  /** 酒馆原生正则脚本 */
  raw: TavernRegexScriptSchema,
});

export type RegexAsset = z.infer<typeof RegexAssetSchema>;

export const regexRouter = crudRouter<RegexAsset>({
  dirOf: () => libraryDir('regex-scripts'),
  schema: RegexAssetSchema,
  label: '正则脚本',
});
