/**
 * 资源库 API 封装（Task 6 四类资产）：当前仅浅列表
 *
 * 消费方：NewWorkDialog 绑定选择（角色卡/世界书/预设下拉）。
 * 完整 CRUD 界面属 Task 25 /library，届时在本文件扩展或按资产拆分。
 */
import { apiFetch } from './client';

/** GET /api/{characters|worldbooks|presets} 浅列表项 */
export interface LibraryAssetRef {
  id: string;
  name: string;
}

export async function listCharacters(): Promise<LibraryAssetRef[]> {
  return apiFetch<LibraryAssetRef[]>('/api/characters');
}

export async function listWorldbooks(): Promise<LibraryAssetRef[]> {
  return apiFetch<LibraryAssetRef[]>('/api/worldbooks');
}

export async function listPresets(): Promise<LibraryAssetRef[]> {
  return apiFetch<LibraryAssetRef[]>('/api/presets');
}
