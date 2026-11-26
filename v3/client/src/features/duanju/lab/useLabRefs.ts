/**
 * 试验台参考图添加（M2）：三条入口（上传图片 / 从本作品选 / 历史图设为参考图）
 * 归结为「一张图的字节 + 一句说明」→ 上传 → 进输入区的参考图列表。
 *
 * 按通道上限拦；上传成功才进列表；失败用人话回报给调用方（试验台的错误条）。
 */
import { useState, type Dispatch, type SetStateAction } from 'react';

import { uploadLabRef } from '../../../api/duanjuLab';
import { fetchWorkImage, refFileProblem, refLimitMessage, refMimeOf, refSlotsLeft, type LabRefOption } from '../lib/lab/refs';
import type { LabInputState } from '../lib/lab/taskState';

interface Options {
  workId: string;
  /** 输入区状态与它的 setter（参考图列表是输入区的一部分） */
  input: LabInputState;
  setInput: Dispatch<SetStateAction<LabInputState>>;
  onError: (message: string) => void;
}

/** 上传文件的默认说明：去掉扩展名的文件名 */
const captionOfFileName = (name: string): string => name.replace(/\.[^.]+$/, '').slice(0, 60);

export function useLabRefs({ workId, input, setInput, onError }: Options) {
  const [addingRef, setAddingRef] = useState(false);

  /** 加一张参考图（字节 + 说明）：按通道上限拦，上传成功才进列表 */
  async function addRef(blob: Blob, caption: string): Promise<void> {
    if (refSlotsLeft(input.provider, input.refs) === 0) throw new Error(refLimitMessage(input.provider));
    setAddingRef(true);
    try {
      const path = await uploadLabRef(workId, new File([blob], 'ref', { type: blob.type }));
      // 上传期间可能换了通道：以那一刻的通道上限为准
      setInput((prev) => (refSlotsLeft(prev.provider, prev.refs) === 0 ? prev : { ...prev, refs: [...prev.refs, { path, caption }] }));
    } finally {
      setAddingRef(false);
    }
  }

  /** 从本作品的图里加（角色设定图 / 场景图 / 历史试验图）：说明由候选自带 */
  async function addRefFrom(option: LabRefOption): Promise<void> {
    await addRef(await fetchWorkImage(workId, option.path), option.caption);
  }

  async function guard(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (e) {
      onError(e instanceof Error ? e.message : '添加参考图失败，请重试');
    }
  }

  return {
    addingRef,
    addUploadedRef: (file: File): void =>
      void guard(async () => {
        const problem = refFileProblem(file);
        const mime = refMimeOf(file);
        if (problem || !mime) throw new Error(problem ?? '参考图只支持 png / jpg');
        await addRef(new File([file], 'ref', { type: mime }), captionOfFileName(file.name));
      }),
    addWorkRef: (option: LabRefOption): void => void guard(() => addRefFrom(option)),
  };
}
