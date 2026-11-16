import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { isAppError, toErrorMessage } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { PAGINATION } from '../config/constants.js';
import type { ApiErrorBody, ApiSuccessBody } from '../types/api.js';

const logger = createLogger('http');
const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
};

export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): Response {
  const body: ApiSuccessBody<T> = { success: true, data };
  return res.status(statusCode).json(body);
}

export function sendPaginated<T>(
  res: Response,
  data: T[],
  pagination: { page: number; pageSize: number; total: number },
): Response {
  const body: ApiSuccessBody<T[]> = {
    success: true,
    data,
    pagination: {
      ...pagination,
      totalPages: Math.max(1, Math.ceil(pagination.total / Math.max(1, pagination.pageSize))),
    },
  };
  return res.status(200).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Không tìm thấy endpoint ${req.method} ${req.originalUrl}`,
    },
  };
  res.status(404).json(body);
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const statusCode = isAppError(error) ? error.statusCode : 500;
  const code = isAppError(error) ? error.code : 'INTERNAL_ERROR';
  const message = isAppError(error)
    ? error.message
    : process.env.NODE_ENV === 'production'
      ? 'Đã xảy ra lỗi phía máy chủ'
      : toErrorMessage(error);

  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} thất bại`, error);
  } else {
    logger.warn(`${req.method} ${req.originalUrl} -> ${statusCode}: ${message}`);
  }

  const body: ApiErrorBody = {
    success: false,
    error: {
      code,
      message,
      ...(isAppError(error) && error.details !== undefined ? { details: error.details } : {}),
    },
  };

  res.status(statusCode).json(body);
}

export interface PaginationInput {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function readPagination(query: Request['query'], defaults?: Partial<PaginationInput>): PaginationInput {
  const page = clampInt(query.page, 1, 1_000_000, defaults?.page ?? PAGINATION.defaultPage);
  const pageSize = clampInt(
    query.pageSize ?? query.limit,
    1,
    PAGINATION.maxPageSize,
    defaults?.pageSize ?? PAGINATION.defaultPageSize,
  );

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function readStringQuery(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return fallback;
}

export function readIdParam(req: Request, name = 'id'): number {
  const raw = req.params[name];
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Tham số "${name}" không hợp lệ`);
  }
  return parsed;
}
