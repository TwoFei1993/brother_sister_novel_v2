/**
 * 生图轻量队列（共识 D6：手动为主+批量；失败隔离；可中止）
 *
 * 并发 2 的串行小队列（generateDuanjuImage 每张 15-30s，避免打满上游限流）。
 * 状态机：pending → running → done | fail；单个失败不阻塞后续；
 * abort() 清空未开始任务，进行中的靠 AbortController（fetch 层由 apiFetch 自身超时兜底）。
 */
import { generateDuanjuImage, type GenerateImageInput } from '../../../api/duanju';
import type { DuanjuProject, StoredImage } from '@shared/duanju';

export interface QueueTask {
  id: string;
  input: GenerateImageInput;
  label: string;
}

export type TaskStatus = 'pending' | 'running' | 'done' | 'fail' | 'aborted';

export interface TaskState {
  status: TaskStatus;
  /** 展示名（如「镜头 3」），enqueue 时登记 */
  label: string;
  image?: StoredImage;
  error?: string;
}

type Listener = (states: Map<string, TaskState>, project: DuanjuProject | null) => void;

const CONCURRENCY = 2;

export class ImageQueue {
  private tasks: QueueTask[] = [];
  private states = new Map<string, TaskState>();
  private running = 0;
  private aborted = false;
  private listeners = new Set<Listener>();
  /** 每张成功后的 project 回调（调用方刷新 store） */
  private onProject: ((p: DuanjuProject) => void) | null = null;

  setOnProject(fn: (p: DuanjuProject) => void): void {
    this.onProject = fn;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(project: DuanjuProject | null = null): void {
    for (const fn of this.listeners) fn(new Map(this.states), project);
  }

  enqueue(workId: string, items: Array<{ input: GenerateImageInput; label: string }>): void {
    this.aborted = false;
    for (const item of items) {
      const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.tasks.push({ id, ...item });
      this.states.set(id, { status: 'pending', label: item.label });
    }
    this.notify();
    void this.pump(workId);
  }

  /** 清空未开始任务；进行中的自然结束 */
  abort(): void {
    this.aborted = true;
    for (const [id, state] of this.states) {
      if (state.status === 'pending') this.states.set(id, { ...state, status: 'aborted' });
    }
    this.tasks = [];
    this.notify();
  }

  get idle(): boolean {
    return this.running === 0;
  }

  private async pump(workId: string): Promise<void> {
    while (!this.aborted && this.running < CONCURRENCY) {
      const task = this.tasks.shift();
      if (!task) break;
      this.running += 1;
      this.states.set(task.id, { ...this.states.get(task.id), status: 'running', label: task.label });
      this.notify();
      void this.execute(workId, task);
    }
  }

  private async execute(workId: string, task: QueueTask): Promise<void> {
    try {
      const { image, project } = await generateDuanjuImage(workId, task.input);
      this.states.set(task.id, { ...this.states.get(task.id), status: 'done', image, label: task.label });
      this.onProject?.(project);
      this.notify(project);
    } catch (err) {
      const message = err instanceof Error ? err.message : '生成失败';
      this.states.set(task.id, { ...this.states.get(task.id), status: 'fail', error: message, label: task.label });
      this.notify();
    } finally {
      this.running -= 1;
      if (!this.aborted) void this.pump(workId);
    }
  }
}
