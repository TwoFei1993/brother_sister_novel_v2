/**
 * 流水线测试用的假后端（内存里的 project + 后台任务队列）。
 * 由测试文件创建实例，再把 apiFetch 装到 vi.mock 里的占位 vi.fn 上——
 * 不要在 vi.mock 工厂里 import 本模块：工厂里 await import 一个测试文件也静态 import 的模块会互相等待，把测试进程挂死。
 */
import type { DuanjuProject } from '@shared/duanju';

import { bgTaskConfig, type BgTaskBody, type BgTaskStatus } from '../../bgTask';
import { WORK } from './fixtures';

export type TaskReply = BgTaskStatus | (() => BgTaskStatus);

interface QueuedTask {
  reply: TaskReply;
  body: BgTaskBody;
}

export class FakeBackend {
  project: DuanjuProject = newDuanju();
  prefs: { source: string; model: string } = { source: 'claude', model: 'test-model' };
  /** 提交过的任务体（按提交顺序） */
  submitted: BgTaskBody[] = [];
  /** 某任务被轮询时的副作用（用来模拟「进行中点停止」） */
  onPoll: ((taskId: string, body: BgTaskBody) => void) | null = null;
  /** 接下来几次 PATCH 强制撞版本冲突 */
  conflicts = 0;
  private seq = 0;
  private queues = new Map<string, TaskReply[]>();
  private tasks = new Map<string, QueuedTask>();

  reset(project: DuanjuProject): void {
    this.project = project;
    this.prefs = { source: 'claude', model: 'test-model' };
    this.submitted = [];
    this.onPoll = null;
    this.conflicts = 0;
    this.queues.clear();
    this.tasks.clear();
    this.seq = 0;
  }

  /** 给某个 label 排一个结果（同 label 多次按先后出队；没排过的 label 一律返回 'OK'） */
  enqueue(label: string, reply: TaskReply): void {
    this.queues.set(label, [...(this.queues.get(label) ?? []), reply]);
  }

  /** 替换某个 label 的全部结果（丢弃之前排的）：用来让某个任务失败 */
  setReplies(label: string, replies: TaskReply[]): void {
    this.queues.set(label, [...replies]);
  }

  /** 直接登记一个「在途任务」（模拟断点里记着的 taskId） */
  putTask(taskId: string, reply: TaskReply, body: BgTaskBody = { source: 'claude', model: 'm', messages: [] }): void {
    this.tasks.set(taskId, { reply, body });
  }

  labels(): string[] {
    return this.submitted.map((b) => b.label ?? '');
  }

  /** 某个 label 的第 n 次提交（缺省第 1 次）的任务体 */
  bodyOf(label: string, nth = 1): BgTaskBody {
    const hits = this.submitted.filter((b) => b.label === label);
    const body = hits[nth - 1];
    if (!body) throw new Error(`没有第 ${nth} 次提交的「${label}」任务`);
    return body;
  }

  apiFetch = async (path: string, init?: RequestInit): Promise<unknown> => {
    const method = init?.method ?? 'GET';
    if (path === '/api/llm/tasks' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as BgTaskBody;
      this.submitted.push(body);
      const id = `t${++this.seq}`;
      this.tasks.set(id, { body, reply: this.queues.get(body.label ?? '')?.shift() ?? { status: 'done', text: 'OK' } });
      return { taskId: id };
    }
    const task = /^\/api\/llm\/tasks\/(.+)$/.exec(path);
    if (task) {
      const t = this.tasks.get(task[1]!);
      if (!t) throw Object.assign(new Error('任务不存在或服务已重启——请重新提交'), { status: 404 });
      this.onPoll?.(task[1]!, t.body);
      return typeof t.reply === 'function' ? t.reply() : t.reply;
    }
    if (path === `/api/works/${WORK}/duanju`) {
      if (method === 'GET') return structuredClone(this.project);
      if (method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (this.conflicts > 0) {
          this.conflicts -= 1;
          throw Object.assign(new Error('版本冲突'), { status: 409 });
        }
        if (body.revision !== this.project.revision) throw Object.assign(new Error('版本冲突'), { status: 409 });
        const { revision: _rev, ...fields } = body;
        this.project = { ...this.project, ...fields, revision: this.project.revision + 1 } as DuanjuProject;
        return structuredClone(this.project);
      }
    }
    throw new Error(`测试没有模拟这个请求：${method} ${path}`);
  };
}

function newDuanju(): DuanjuProject {
  return {
    revision: 1,
    script: { source: 'pasted', text: '', confirmed: true, updatedAt: 1 },
    reviewCards: {
      summary: '',
      eventChain: [],
      conflict: '',
      characterRelations: '',
      emotionPoints: [],
      visualActions: [],
      riskReplacements: [],
    },
    style: '动漫风',
    targetEpisodes: 3,
    protagonists: '',
    characters: [],
    scenes: [],
    props: [],
    episodes: [],
    shots: [],
    spendLog: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

export function createFakeBackend(): FakeBackend {
  return new FakeBackend();
}

/** 轮询不等待：测试里任务「立刻」有结果 */
export function speedUpPolling(): void {
  bgTaskConfig.intervalMs = 0;
}
