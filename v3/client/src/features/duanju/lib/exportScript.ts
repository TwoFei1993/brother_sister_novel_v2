/**
 * 剧本导出（用户反馈 #3）：md（表格，含时间码）与 txt（阅读剧本格式）双格式
 *
 * 时间轴 = 前序镜头 durationSec 累加（0:00-0:08 形式，秒级精度）；
 * 未填时长的镜头按 8 秒估算并在表内标注。
 */
import type { DuanjuEpisode, DuanjuProject, DuanjuShot } from '@shared/duanju';
import { stylePrefix } from './prompts/prompts-image';

const DEFAULT_SEC = 8;

/** 时间码：秒 → m:ss */
function tc(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** 本集镜头时间轴：[{shot, start, end, estimated}] */
export function buildTimeline(shots: DuanjuShot[]): Array<{ shot: DuanjuShot; start: number; end: number; estimated: boolean }> {
  let cursor = 0;
  return shots.map((s) => {
    const dur = s.durationSec ?? DEFAULT_SEC;
    const seg = { shot: s, start: cursor, end: cursor + dur, estimated: s.durationSec === undefined };
    cursor += dur;
    return seg;
  });
}

const esc = (s: string): string => s.replace(/\|/g, '\\|');

/** 角色出场标记（S01 前缀 + 角色名清单） */
function castOf(shot: DuanjuShot, project: DuanjuProject): string {
  return shot.characterIds
    .map((cid) => project.characters.find((c) => c.id === cid)?.name)
    .filter((n): n is string => !!n)
    .join('·');
}

/** markdown 版：可读排版 + 完整信息表 */
export function buildScriptMd(project: DuanjuProject, episode: DuanjuEpisode, shots: DuanjuShot[]): string {
  const timeline = buildTimeline(shots);
  const total = timeline.at(-1)?.end ?? 0;
  const lines: string[] = [
    `# 第 ${episode.index} 集《${episode.title}》`,
    '',
    `> ${project.style} · 预估时长 ${tc(total)} · ${shots.length} 个镜头 · 生成时间 ${new Date().toLocaleString('zh-CN')}`,
    episode.synopsis ? `> 本集梗概：${episode.synopsis}` : '',
    '',
    '## 时间轴分镜',
    '',
    '| 时间码 | 镜头 | 景别 | 运镜 | 时长 | 人物 | 站位 | 动作 | 台词 | 声音 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const seg of timeline) {
    const { shot, start, end, estimated } = seg;
    lines.push(
      `| ${tc(start)}-${tc(end)}${estimated ? '*' : ''} | S${String(shot.index).padStart(2, '0')} | ${esc(shot.shotSize)} | ${esc(shot.cameraMove)} | ${shot.durationSec ?? DEFAULT_SEC}s | ${esc(castOf(shot, project))} | ${esc(shot.staging)} | ${esc(`${shot.actionStart} → ${shot.actionEnd}`)} | ${esc(shot.dialog)} | ${esc(shot.sound)} |`,
    );
  }
  lines.push('', '## 分镜详述', '');
  for (const seg of timeline) {
    const s = seg.shot;
    lines.push(
      `### S${String(s.index).padStart(2, '0')}〔${tc(seg.start)}-${tc(seg.end)}〕${s.shotSize}·${s.cameraMove}`,
      '',
      `- **动作**：${s.actionStart} → ${s.actionEnd}`,
      s.dialog ? `- **台词**：「${s.dialog}」` : '- **台词**：（无）',
      `- **声音**：${s.sound || '环境音'}`,
      s.staging ? `- **站位**：${s.staging}` : '',
      '',
      s.gridPrompt ? `> 生图提示词：${s.gridPrompt.replace(/\n/g, ' ')}` : '',
      '',
    );
  }
  return lines.filter((l) => l !== '').join('\n') + '\n';
}

/** txt 版：纯文本阅读剧本（导演工作本风格） */
export function buildScriptTxt(project: DuanjuProject, episode: DuanjuEpisode, shots: DuanjuShot[]): string {
  const timeline = buildTimeline(shots);
  const total = timeline.at(-1)?.end ?? 0;
  const bar = '─'.repeat(46);
  const out: string[] = [
    `《${project.protagonists ? '' : ''}${episode.title}》`,
    `第 ${episode.index} 集 · ${project.style} · 预估时长 ${tc(total)} · ${shots.length} 镜`,
    bar,
  ];
  if (episode.synopsis) out.push(`【本集梗概】${episode.synopsis}`, '');
  for (const seg of timeline) {
    const s = seg.shot;
    out.push(
      `▣ S${String(s.index).padStart(2, '0')}　${tc(seg.start)} - ${tc(seg.end)}（${s.durationSec ?? DEFAULT_SEC}秒${seg.estimated ? '·估' : ''}）`,
      `　　${s.shotSize}｜${s.cameraMove}｜人物：${castOf(s, project) || '—'}`,
      s.staging ? `　　站位：${s.staging}` : '',
      `　　动作：${s.actionStart} → ${s.actionEnd}`,
      s.dialog ? `　　台词：「${s.dialog}」` : '',
      `　　声音：${s.sound || '环境音'}`,
      '',
    );
  }
  out.push(bar, `画风：${stylePrefix(project.style)}｜本集完`, '');
  return out.join('\n');
}

/** 触发浏览器下载（Blob） */
export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
