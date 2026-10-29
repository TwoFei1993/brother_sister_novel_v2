/**
 * AI 配音导演（反馈：分配应有 AI 智能分配）：角色人设 → 从 MiniMax 音色目录中选声。
 * 另含 AI 人物识别归并（反馈：识别不准——「镇国公坐到床边」「镇国公低声道」应都归为镇国公）。
 *
 * - generateTextOnce（非流式，预算兜底重试内置）；要求严格 JSON 输出
 * - 解析后逐个校验：选中的 id 必须在目录内（幻觉 id 置空，由调用方用性别启发式兜底）
 */
import { generateTextOnce } from '../../../../api/llm';
import { useSettingsStore } from '../../../../stores/settings';
import type { CastVoiceOption } from '../../../../lib/tts/mobile-cast';

/** 参与分配的角色简介（desc 取角色卡 description/personality 摘要） */
export interface RoleBrief {
  name: string;
  desc: string;
}

/** 前缀扫描候选 → LLM 归并同一角色的不同写法、剔除非角色名；失败由调用方降级回正则结果 */
export async function aiNormalizeSpeakers(candidates: ReadonlyArray<{ name: string; count: number }>): Promise<string[]> {
  const prefs = useSettingsStore.getState().llmPrefs;
  const listText = candidates.map((c) => `${c.name}（出现 ${c.count} 次）`).join('\n');
  const text = await generateTextOnce(
    {
      source: prefs.source,
      model: prefs.model,
      temperature: 0.2,
      thinking: prefs.thinking !== false,
      messages: [
        {
          role: 'user',
          content:
            `以下是从小说正文「角色名：对白」格式提取的说话人候选（正则粗扫，含误报和同一角色的不同写法）。\n` +
            `请整理出真正的角色名清单：归并同一角色的变体（如「镇国公坐到床边」「镇国公低声道」都是镇国公；「崔氏笑道」归为崔氏），` +
            `剔除明显不是角色名的（叙述句、代词开头等）。\n` +
            `输出严格的 JSON 字符串数组（如 ["镇国公","崔氏"]），不要任何解释。\n\n${listText}`,
        },
      ],
    },
    4096,
  );
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const jsonText = /\[[\s\S]*\]/.exec(cleaned)?.[0];
  if (!jsonText) throw new Error('AI 返回格式异常');
  const parsed = JSON.parse(jsonText) as unknown;
  if (!Array.isArray(parsed)) throw new Error('AI 返回格式异常');
  return parsed.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
}

export async function aiAssignVoices(roles: readonly RoleBrief[], catalog: readonly CastVoiceOption[]): Promise<Record<string, string>> {
  if (roles.length === 0) return {};
  const prefs = useSettingsStore.getState().llmPrefs;
  const catalogText = catalog
    .filter((v) => v.engine === 'minimax')
    .map((v) => `${v.id}|${v.name}|${v.gender === 'female' ? '女' : '男'}`)
    .join('\n');
  const rolesText = roles.map((r, i) => `${i + 1}. ${r.name}：${r.desc.slice(0, 160) || '（无人设描述）'}`).join('\n');
  const text = await generateTextOnce(
    {
      source: prefs.source,
      model: prefs.model,
      temperature: 0.3,
      // 思考跟随用户设置（MiniMax-M3.1 等推理模型不支持强制关闭，写死 false 会空输出）
      thinking: prefs.thinking !== false,
      messages: [
        {
          role: 'user',
          content:
            `你是有声书配音导演。为下列小说角色从音色目录中各选一个最合适的 MiniMax 音色。\n` +
            `规则：音色性别必须与角色性别一致；按身份/性格匹配风格；每个角色的选择唯一；只能从目录中选。\n` +
            `性别判断：人设明确的以人设为准；只有名字时按常见命名的性别倾向判断，拿不准的一律选女声（女频小说女性角色占绝大多数），` +
            `仅当名字带明显男性用字（哥/兄/爷/叔/父/公子/少爷/山/峰/龙等）或人设表明男性时才选男声。\n` +
            `输出严格的 JSON 对象（键=角色名，值=voice_id），不要任何解释或代码块标记。\n\n` +
            `【角色】\n${rolesText}\n\n【音色目录】voice_id|名称|性别\n${catalogText}`,
        },
      ],
    },
    8192,
  );
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const jsonText = /\{[\s\S]*\}/.exec(cleaned)?.[0];
  if (!jsonText) throw new Error('AI 返回格式异常，请重试');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new Error('AI 返回的 JSON 无法解析，请重试');
  }
  const valid = new Set(catalog.map((v) => v.id));
  const out: Record<string, string> = {};
  for (const r of roles) {
    const picked = parsed[r.name];
    out[r.name] = typeof picked === 'string' && valid.has(picked) ? picked : '';
  }
  return out;
}
