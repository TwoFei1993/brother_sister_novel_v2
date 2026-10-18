/**
 * zod 请求校验包装器：失败统一 400 + 人话错误消息（设计 §9.1）
 * HttpError 同时供业务路由抛"带状态码的错误"，由 app.ts 错误处理器统一转 JSON。
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { type ZodError, type ZodTypeAny } from 'zod';

/** 携带 HTTP 状态码的业务错误（错误处理器据此回 JSON） */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** 把 zod 错误压成一句中文人话：字段路径 + 原因（取第一条足够定位） */
export function formatZodError(error: ZodError): string {
  const first = error.issues[0];
  if (!first) return '请求内容不合法';
  const where = first.path.length > 0 ? `${first.path.join('.')}: ` : '';
  return `${where}${first.message}`;
}

/**
 * zod body 校验包装器：通过则 req.body 替换为解析后的强类型数据
 * （等价于 z.infer<T>），失败则抛 400 HttpError。
 */
export function zodBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      next(new HttpError(400, `请求体不合法：${formatZodError(parsed.error)}`));
      return;
    }
    req.body = parsed.data;
    next();
  };
}
