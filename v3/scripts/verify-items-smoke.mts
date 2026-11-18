/**
 * 物品道具 CRUD 真实冒烟（UTF-8 安全——Windows shell 里 curl 发中文会被 GBK 编码弄花）：
 * POST → GET 列表/详情 → PATCH 浅合并 → DELETE 幂等 → 清理验证数据。
 */
const BASE = 'http://localhost:3001';
const PASSWORD = process.env.ACCESS_PASSWORD ?? 'dev123';

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: PASSWORD }),
});
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
if (!cookie) throw new Error('登录失败');
const H = { 'Content-Type': 'application/json', Cookie: cookie };

const item = {
  name: '母亲的银锁',
  summary: '验证用：藏着母亲字条的旧银锁',
  texture: '温润的羊脂玉触感',
  shape: '拇指大小的圆锁，环刻缠枝纹',
  color: '月白色，泛淡银光',
  usage: '贴身佩戴时安抚异能反噬；离开身体超过一炷香即失效',
  emotion: '母亲唯一的遗物',
};
const created = await (await fetch(`${BASE}/api/items`, { method: 'POST', headers: H, body: JSON.stringify(item) })).json();
console.log('POST →', created.id ? `✅ ${created.id} / ${created.name} / 质感=${created.texture}` : `❌ ${JSON.stringify(created)}`);

const list = (await (await fetch(`${BASE}/api/items`, { headers: H })).json()) as Array<{ id: string; name: string }>;
console.log('LIST →', list.some((x) => x.id === created.id) ? `✅ 列表含新物品（共 ${list.length} 条）` : '❌ 列表缺失');

const patched = await (
  await fetch(`${BASE}/api/items/${created.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ emotion: '兄妹共同守护的羁绊信物' }) })
).json();
console.log('PATCH →', patched.emotion === '兄妹共同守护的羁绊信物' && patched.texture === item.texture ? '✅ 浅合并（emotion 改、texture 留）' : `❌ ${JSON.stringify(patched)}`);

const del = await fetch(`${BASE}/api/items/${created.id}`, { method: 'DELETE', headers: H });
const after = (await (await fetch(`${BASE}/api/items`, { headers: H })).json()) as Array<{ id: string }>;
console.log('DELETE →', del.ok && !after.some((x) => x.id === created.id) ? '✅ 已删除且列表干净' : '❌ 删除异常');
