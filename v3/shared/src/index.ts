/**
 * @v3/shared 汇出入口
 * 内部格式：Message / Work / NovelSettings / 三类资产壳（strict）
 * 酒馆原生格式：世界书 / 预设 / 正则 / V2 卡（passthrough 宽松，roundtrip 不丢字段）
 */
export * from './message';
export * from './comment';
export * from './community';
export * from './assets/origin';
export * from './assets/faction';
export * from './work';
export * from './card';
export * from './worldbook';
export * from './preset';
export * from './tavern';
