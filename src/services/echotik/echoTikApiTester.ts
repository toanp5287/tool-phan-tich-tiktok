import { getEchoTikClient } from './echoTikClient.js';
import { createLogger } from '../../utils/logger.js';
import { env } from '../../config/env.js';

const logger = createLogger('echotik-api-tester');

export interface ApiTestResult {
  endpoint: string;
  success: boolean;
  statusCode?: number;
  recordsReceived: number;
  requestsUsed: number;
  responseSchema: Record<string, unknown>;
  sampleData?: Record<string, unknown>;
  error?: string;
  unverifiedFields: string[];
}

export interface TestSummary {
  totalRequests: number;
  totalRecords: number;
  results: ApiTestResult[];
  quotaBefore: number;
  quotaAfter: number;
  quotaUsed: number;
}

/**
 * Kiểm tra API endpoints thực tế từ EchoTik
 * KHÔNG ingest vào database
 * Chỉ thu thập schema và response data
 */
export class EchoTikApiTester {
  private client = getEchoTikClient();
  private results: ApiTestResult[] = [];
  private totalRequests = 0;
  private totalRecords = 0;
  private firstProductId: string | null = null;

  /**
   * Test tất cả 5 endpoints theo thứ tự
   */
  async runAllTests(): Promise<TestSummary> {
    logger.info('Starting EchoTik API test (no ingestion)');

    try {
      // 1. Test Category L1
      await this.testCategoryL1();
      this.totalRequests += 1;

      // 2. Test Category L2 (dùng L1 ID từ kết quả trước)
      await this.testCategoryL2();
      this.totalRequests += 1;

      // 3. Test Product List (1 call)
      await this.testProductList();
      this.totalRequests += 1;

      // 4. Test Product Trend (1 call với product_id thật)
      await this.testProductTrend();
      this.totalRequests += 1;

      // 5. Test Seller List (1 call)
      await this.testSellerList();
      this.totalRequests += 1;

      logger.info(`API test completed. Total requests: ${this.totalRequests}`);

      return {
        totalRequests: this.totalRequests,
        totalRecords: this.totalRecords,
        results: this.results,
        quotaBefore: env.echotik.maxRequestsPerMonth,
        quotaAfter: env.echotik.maxRequestsPerMonth - this.totalRequests,
        quotaUsed: this.totalRequests,
      };
    } catch (error) {
      logger.error(`API test failed: ${error}`);
      throw error;
    }
  }

  /**
   * Test Category L1
   */
  private async testCategoryL1(): Promise<void> {
    try {
      logger.info('Testing: GET /api/v3/echotik/category/l1');
      
      const response = (await this.client.getCategoryL1(env.echotik.language)) as Record<
        string,
        unknown
      >;

      const schema = this.extractSchema(response);
      const data = Array.isArray(response.data) ? response.data : [];
      const sample = data[0] as Record<string, unknown> | undefined;

      this.results.push({
        endpoint: 'GET /api/v3/echotik/category/l1',
        success: true,
        recordsReceived: data.length,
        requestsUsed: 1,
        responseSchema: schema,
        sampleData: sample,
        unverifiedFields: this.findUnverifiedFields(sample),
      });

      this.totalRecords += data.length;
      logger.info(`Category L1: ${data.length} categories received`);
    } catch (error) {
      this.results.push({
        endpoint: 'GET /api/v3/echotik/category/l1',
        success: false,
        recordsReceived: 0,
        requestsUsed: 1,
        responseSchema: {},
        error: String(error),
        unverifiedFields: [],
      });

      logger.error(`Category L1 test failed: ${error}`);
    }
  }

  /**
   * Test Category L2 (dùng L1 ID từ kết quả)
   */
  private async testCategoryL2(): Promise<void> {
    try {
      logger.info('Testing: GET /api/v3/echotik/category/l2');

      // Lấy L1 ID từ kết quả trước (nếu có)
      const l1Result = this.results.find((r) => r.endpoint.includes('category/l1'));
      const l1Sample = l1Result?.sampleData as Record<string, unknown> | undefined;
      const parentId = (l1Sample?.categoryId as string) || 'test-category-id';

      const response = (await this.client.getCategoryL2(
        parentId,
        env.echotik.language,
      )) as Record<string, unknown>;

      const schema = this.extractSchema(response);
      const data = Array.isArray(response.data) ? response.data : [];
      const sample = data[0] as Record<string, unknown> | undefined;

      this.results.push({
        endpoint: 'GET /api/v3/echotik/category/l2',
        success: true,
        recordsReceived: data.length,
        requestsUsed: 1,
        responseSchema: schema,
        sampleData: sample,
        unverifiedFields: this.findUnverifiedFields(sample),
      });

      this.totalRecords += data.length;
      logger.info(`Category L2: ${data.length} categories received`);
    } catch (error) {
      this.results.push({
        endpoint: 'GET /api/v3/echotik/category/l2',
        success: false,
        recordsReceived: 0,
        requestsUsed: 1,
        responseSchema: {},
        error: String(error),
        unverifiedFields: [],
      });

      logger.error(`Category L2 test failed: ${error}`);
    }
  }

  /**
   * Test Product List (1 call: page_num=1, page_size=10)
   */
  private async testProductList(): Promise<void> {
    try {
      logger.info('Testing: GET /api/v3/echotik/product/list');

      const response = (await this.client.getProductList(1, 10, env.echotik.region)) as Record<
        string,
        unknown
      >;

      const schema = this.extractSchema(response);
      const data = Array.isArray(response.data) ? response.data : [];
      const sample = data[0] as Record<string, unknown> | undefined;

      // Lưu product_id đầu tiên để dùng cho trend test
      if (sample && 'product_id' in sample) {
        this.firstProductId = sample.product_id as string;
      }

      this.results.push({
        endpoint: 'GET /api/v3/echotik/product/list',
        success: true,
        recordsReceived: data.length,
        requestsUsed: 1,
        responseSchema: schema,
        sampleData: sample,
        unverifiedFields: this.findUnverifiedFields(sample),
      });

      this.totalRecords += data.length;
      logger.info(`Product List: ${data.length} products received`);
    } catch (error) {
      this.results.push({
        endpoint: 'GET /api/v3/echotik/product/list',
        success: false,
        recordsReceived: 0,
        requestsUsed: 1,
        responseSchema: {},
        error: String(error),
        unverifiedFields: [],
      });

      logger.error(`Product List test failed: ${error}`);
    }
  }

  /**
   * Test Product Trend (1 call với product_id thật)
   */
  private async testProductTrend(): Promise<void> {
    try {
      logger.info('Testing: GET /api/v3/echotik/product/trend');

      if (!this.firstProductId) {
        throw new Error('No product_id available from Product List test');
      }

      // Tính date range: 30 ngày trước hôm nay
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      const formatDate = (d: Date): string => d.toISOString().split('T')[0] ?? '';

      const response = (await this.client.getProductTrend(
        this.firstProductId || '',
        formatDate(startDate),
        formatDate(endDate),
        1,
        10,
      )) as Record<string, unknown>;

      const schema = this.extractSchema(response);
      const data = Array.isArray(response.data) ? response.data : [];
      const sample = data[0] as Record<string, unknown> | undefined;

      this.results.push({
        endpoint: 'GET /api/v3/echotik/product/trend',
        success: true,
        recordsReceived: data.length,
        requestsUsed: 1,
        responseSchema: schema,
        sampleData: sample,
        unverifiedFields: this.findUnverifiedFields(sample),
      });

      this.totalRecords += data.length;
      logger.info(`Product Trend: ${data.length} trends received`);
    } catch (error) {
      this.results.push({
        endpoint: 'GET /api/v3/echotik/product/trend',
        success: false,
        recordsReceived: 0,
        requestsUsed: 1,
        responseSchema: {},
        error: String(error),
        unverifiedFields: [],
      });

      logger.error(`Product Trend test failed: ${error}`);
    }
  }

  /**
   * Test Seller List (1 call: page_num=1, page_size=10)
   */
  private async testSellerList(): Promise<void> {
    try {
      logger.info('Testing: GET /api/v3/echotik/seller/list');

      const response = (await this.client.getSellerList(1, 10, env.echotik.region)) as Record<
        string,
        unknown
      >;

      const schema = this.extractSchema(response);
      const data = Array.isArray(response.data) ? response.data : [];
      const sample = data[0] as Record<string, unknown> | undefined;

      this.results.push({
        endpoint: 'GET /api/v3/echotik/seller/list',
        success: true,
        recordsReceived: data.length,
        requestsUsed: 1,
        responseSchema: schema,
        sampleData: sample,
        unverifiedFields: this.findUnverifiedFields(sample),
      });

      this.totalRecords += data.length;
      logger.info(`Seller List: ${data.length} sellers received`);
    } catch (error) {
      this.results.push({
        endpoint: 'GET /api/v3/echotik/seller/list',
        success: false,
        recordsReceived: 0,
        requestsUsed: 1,
        responseSchema: {},
        error: String(error),
        unverifiedFields: [],
      });

      logger.error(`Seller List test failed: ${error}`);
    }
  }

  /**
   * Extract schema từ response
   */
  private extractSchema(response: Record<string, unknown>): Record<string, unknown> {
    const schema: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(response)) {
      if (Array.isArray(value)) {
        schema[key] = 'array';
      } else if (value === null) {
        schema[key] = 'null';
      } else {
        schema[key] = typeof value;
      }
    }

    return schema;
  }

  /**
   * Tìm các field không xác minh (có thể là unit không rõ, format lạ, etc.)
   */
  private findUnverifiedFields(sample?: Record<string, unknown>): string[] {
    if (!sample) return [];

    const unverified: string[] = [];
    const fieldsNeedingVerification = [
      'gmv',
      'gmvTotal',
      'gmv1d',
      'gmv7d',
      'gmv30d',
      'soldCount',
      'soldCountTotal',
      'price',
      'currency',
      'capturedAt',
      'timestamp',
    ];

    for (const field of fieldsNeedingVerification) {
      if (field in sample) {
        unverified.push(`${field} (unit/format not verified)`);
      }
    }

    return unverified;
  }
}
