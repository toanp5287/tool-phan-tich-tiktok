import { env, isEchoTikEnabled } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { reserveEchoTikRequest } from './echoTikQuotaService.js';
import { echoTikSyncContext } from './echoTikSyncContext.js';
import { randomUUID } from 'node:crypto';
import type {
  EchoTikSearchResponse,
  EchoTikCategoryResponse,
  EchoTikSellerResponse,
  EchoTikQuotaInfo,
  EchoTikApiError,
} from '../../types/echotik.js';

const logger = createLogger('echotik-client');

export class EchoTikClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private timeoutMs: number;

  constructor() {
    if (!isEchoTikEnabled()) {
      throw new AppError(
        'EchoTik is not enabled. Set ECHOTIK_ENABLED=true and provide ECHOTIK_USERNAME/ECHOTIK_PASSWORD in .env',
        503,
        'ECHOTIK_NOT_CONFIGURED',
      );
    }

    if (!env.echotik.username || !env.echotik.password) {
      throw new AppError(
        'EchoTik credentials not configured. Set ECHOTIK_USERNAME and ECHOTIK_PASSWORD in .env',
        503,
        'ECHOTIK_CREDENTIALS_MISSING',
      );
    }

    this.baseUrl = env.echotik.baseUrl;
    this.username = env.echotik.username;
    this.password = env.echotik.password;
    this.timeoutMs = env.echotik.timeoutMs;
  }

  private getHeaders(): Record<string, string> {
    const credentials = `${this.username}:${this.password}`;
    const encoded = Buffer.from(credentials).toString('base64');

    return {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${encoded}`,
      'User-Agent': 'TikTok-Analytics-Bot/1.0',
    };
  }

  private async fetch<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const context = echoTikSyncContext.getStore();
    if (!context?.recordRequest) throw new Error('Use a guarded EchoTik group command; direct API calls are disabled');
    const url = `${this.baseUrl}${path}`;
    const requestId = randomUUID();
    let status: number | null = null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      await context.recordRequest({ requestId, endpoint: path, phase: 'intent', timestamp: new Date().toISOString() });
      await reserveEchoTikRequest(`${method} ${path.split('?')[0]}`);
      await context.recordRequest({ requestId, endpoint: path, phase: 'dispatch', timestamp: new Date().toISOString() });
      const response = await fetch(url, {
        method,
        headers: this.getHeaders(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: 'error',
      });
      status = response.status;
      await context.recordRequest({ requestId, endpoint: path, phase: 'response', httpStatus: status, timestamp: new Date().toISOString() });

      if (!response.ok) {
        const errorData = await this.parseErrorResponse(response);
        throw this.createError(errorData);
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      await context.recordRequest({ requestId, endpoint: path, phase: 'error', httpStatus: status,
        message: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() });
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError(
          `EchoTik request timeout (${this.timeoutMs}ms)`,
          504,
          'ECHOTIK_TIMEOUT',
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async parseErrorResponse(response: Response): Promise<EchoTikApiError> {
    try {
      const data = (await response.json()) as Record<string, unknown>;
      return {
        code: (data.errorCode as string) ?? 'UNKNOWN',
        message: (data.error as string) ?? (data.message as string) ?? response.statusText,
        statusCode: response.status,
        retryable: response.status >= 500 || response.status === 429,
      };
    } catch {
      return {
        code: 'PARSE_ERROR',
        message: response.statusText,
        statusCode: response.status,
        retryable: response.status >= 500,
      };
    }
  }

  private createError(error: EchoTikApiError): AppError {
    return new AppError(`EchoTik API error: ${error.message}`, error.statusCode, error.code);
  }

  /**
   * Lấy danh sách seller/cửa hàng
   * GET /api/v3/echotik/seller/list
   * Required: region, page_num, page_size
   */
  async getSellerList(pageNum: number = 1, pageSize: number = 10, region: string = 'VN') {
    const queryString = new URLSearchParams();
    queryString.append('region', region);
    queryString.append('page_num', String(pageNum));
    queryString.append('page_size', String(pageSize));

    const path = `/api/v3/echotik/seller/list?${queryString}`;
    return this.fetch<Record<string, unknown>>('GET', path);
  }

  /**
   * Tìm kiếm sản phẩm theo trend
   * GET /api/v3/echotik/product/trend
   * Required: product_id, start_date, end_date, page_num, page_size
   */
  async getProductTrend(
    productId: string,
    startDate: string,
    endDate: string,
    pageNum: number = 1,
    pageSize: number = 10,
  ) {
    const queryString = new URLSearchParams();
    queryString.append('product_id', productId);
    queryString.append('start_date', startDate);
    queryString.append('end_date', endDate);
    queryString.append('page_num', String(pageNum));
    queryString.append('page_size', String(pageSize));

    const path = `/api/v3/echotik/product/trend?${queryString}`;
    return this.fetch<Record<string, unknown>>('GET', path);
  }

  /**
   * Lấy danh sách sản phẩm
   * GET /api/v3/echotik/product/list
   * Required: region, page_num, page_size
   */
  async getProductList(pageNum: number = 1, pageSize: number = 10, region: string = 'VN') {
    const queryString = new URLSearchParams();
    queryString.append('region', region);
    queryString.append('page_num', String(pageNum));
    queryString.append('page_size', String(pageSize));

    const path = `/api/v3/echotik/product/list?${queryString}`;
    return this.fetch<Record<string, unknown>>('GET', path);
  }

  /**
   * Lấy danh sách category L1
   * GET /api/v3/echotik/category/l1
   * Required: language=vi-VN
   */
  async getCategoryL1(language: string = 'vi-VN') {
    const queryString = new URLSearchParams();
    queryString.append('language', language);

    const path = `/api/v3/echotik/category/l1?${queryString}`;
    return this.fetch<Record<string, unknown>>('GET', path);
  }

  /**
   * Lấy danh sách category L2
   * GET /api/v3/echotik/category/l2
   * Required: language=vi-VN, parent_id=<L1_ID>
   */
  async getCategoryL2(parentId: string, language: string = 'vi-VN') {
    const queryString = new URLSearchParams();
    queryString.append('language', language);
    queryString.append('parent_id', parentId);

    const path = `/api/v3/echotik/category/l2?${queryString}`;
    return this.fetch<Record<string, unknown>>('GET', path);
  }

  // Single-page, explicit demo calls. No retries or automatic pagination.
  async getDemoCandidates() {
    return this.fetch<unknown>('GET', '/api/v3/echotik/product/list?region=VN&off_mark=0&min_total_ifl_cnt=3&min_total_video_cnt=2&page_num=1&page_size=10');
  }

  async getDemoData(endpoint: 'product/detail' | 'seller/detail' | 'product/video/list' | 'product/influencer/list' | 'influencer/detail' | 'video/detail', ids: string[]) {
    if (ids.length < 1 || ids.length > 10 || ids.some((id) => !/^\d+$/.test(id))) throw AppError.badRequest('Invalid EchoTik IDs');
    const keys = { 'product/detail': 'product_ids', 'seller/detail': 'seller_id', 'product/video/list': 'product_id', 'product/influencer/list': 'product_id', 'influencer/detail': 'user_ids', 'video/detail': 'video_ids' };
    if (!['product/detail', 'influencer/detail', 'video/detail'].includes(endpoint) && ids.length !== 1) throw AppError.badRequest('Endpoint requires one ID');
    const query = new URLSearchParams({ [keys[endpoint]]: ids.join(',') });
    if (endpoint.endsWith('/list')) { query.set('page_num', '1'); query.set('page_size', '10'); }
    return this.fetch<unknown>('GET', `/api/v3/echotik/${endpoint}?${query}`);
  }
}

let cachedClient: EchoTikClient | null = null;

export function getEchoTikClient(): EchoTikClient {
  if (!isEchoTikEnabled()) {
    throw new AppError(
      'EchoTik is not enabled. Set ECHOTIK_API_KEY in .env',
      503,
      'ECHOTIK_NOT_CONFIGURED',
    );
  }

  cachedClient ??= new EchoTikClient();
  return cachedClient;
}
