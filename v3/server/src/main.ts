// 最小服务端入口：仅供 Task 1 验证 dev.sh 前后端联动
// 完整骨架（pino 日志 / 鉴权 / 路由组挂载 / 静态托管）见 Task 3
import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 3001);

// 探活端点：dev.sh 联动验证用
app.get('/api/ping', (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`[server] 开发骨架已启动：http://localhost:${port}（探活 /api/ping）`);
});
