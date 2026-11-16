import { env, isEchoTikEnabled } from '../../config/env.js';

export interface AuthCheckResult {
  enabled: boolean;
  configured: boolean;
  credentialsSet: boolean;
  baseUrlValid: boolean;
  region: string;
  language: string;
  timeout: number;
  maxRequestsPerMonth: number;
  issues: string[];
  warnings: string[];
}

export interface RequestBudgetEstimate {
  estimatedRequestsPerSync: string; // e.g., "12-22"
  maxSyncsPerMonth: string; // e.g., "2-4"
  syncsPerWeek: string;
  quotaLimit: number;
}

export interface EndpointInfo {
  path: string;
  method: string;
  description: string;
  requestsPerSync: string | number;
}

/**
 * Kiểm tra cấu hình xác thực EchoTik
 * Không in credentials, không gọi API
 */
export function verifyEchoTikAuth(): AuthCheckResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  // 1. Kiểm tra enabled flag
  const enabled = env.echotik.enabled;

  if (!enabled) {
    warnings.push('EchoTik is currently disabled');
  }

  // 2. Kiểm tra credentials (không in ra)
  const credentialsSet = !!env.echotik.username && !!env.echotik.password;
  
  if (!env.echotik.username) {
    issues.push('ECHOTIK_USERNAME is not set');
  }

  if (!env.echotik.password) {
    issues.push('ECHOTIK_PASSWORD is not set');
  }

  // 3. Kiểm tra Basic Auth header format (không in credentials)
  const basicAuthValid = validateBasicAuthFormat(env.echotik.username, env.echotik.password);
  if (!basicAuthValid && credentialsSet) {
    issues.push('Basic Auth header format is invalid');
  }

  // 4. Kiểm tra base URL
  const baseUrlValid = isValidUrl(env.echotik.baseUrl);
  if (!baseUrlValid) {
    issues.push(`ECHOTIK_BASE_URL is invalid: ${env.echotik.baseUrl}`);
  }

  // 5. Kiểm tra timeout
  if (env.echotik.timeoutMs < 5000) {
    warnings.push(`ECHOTIK_TIMEOUT is very low (${env.echotik.timeoutMs}ms)`);
  }

  const configured = enabled && credentialsSet && baseUrlValid;

  const result: AuthCheckResult = {
    enabled,
    configured,
    credentialsSet,
    baseUrlValid,
    region: env.echotik.region,
    language: env.echotik.language,
    timeout: env.echotik.timeoutMs,
    maxRequestsPerMonth: env.echotik.maxRequestsPerMonth,
    issues,
    warnings,
  };

  return result;
}

/**
 * Kiểm tra Basic Auth header format (không in credentials)
 */
function validateBasicAuthFormat(username?: string, password?: string): boolean {
  if (!username || !password) return false;

  try {
    const credentials = `${username}:${password}`;
    const encoded = Buffer.from(credentials).toString('base64');
    // Kiểm tra encoded string không rỗng và hợp lệ
    return encoded.length > 0 && /^[A-Za-z0-9+/=]+$/.test(encoded);
  } catch {
    return false;
  }
}

/**
 * Kiểm tra URL hợp lệ
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Danh sách các endpoint dự kiến
 */
export function getEndpointInfo(): EndpointInfo[] {
  return [
    {
      path: 'GET /v1/products/search',
      method: 'GET',
      description: 'Search products by keyword',
      requestsPerSync: 1,
    },
    {
      path: 'GET /v1/categories',
      method: 'GET',
      description: 'Get all categories (L1/L2/L3)',
      requestsPerSync: 1,
    },
    {
      path: 'GET /v1/sellers/{id}',
      method: 'GET',
      description: 'Get seller/shop details',
      requestsPerSync: '10-20 (per top shops)',
    },
    {
      path: 'GET /v1/quota',
      method: 'GET',
      description: 'Check remaining quota',
      requestsPerSync: 1,
    },
  ];
}

/**
 * Ước tính request budget
 */
export function estimateRequestBudget(): RequestBudgetEstimate {
  const quotaLimit = env.echotik.maxRequestsPerMonth;

  // Mỗi sync: 1 search + 1 categories + 10-20 sellers + 1 quota = 13-23 requests
  const minPerSync = 13;
  const maxPerSync = 23;

  const maxSyncsPerMonth = Math.floor(quotaLimit / maxPerSync);
  const syncsPerWeek = (maxSyncsPerMonth / 4).toFixed(1);

  return {
    estimatedRequestsPerSync: `${minPerSync}-${maxPerSync}`,
    maxSyncsPerMonth: `${maxSyncsPerMonth || '<1'}`,
    syncsPerWeek,
    quotaLimit,
  };
}

/**
 * Generate full report (không in credentials)
 */
export function generateAuthReport(): string {
  const authCheck = verifyEchoTikAuth();
  const endpoints = getEndpointInfo();
  const budget = estimateRequestBudget();

  const lines = [
    '========================================',
    'ECHOTIK AUTHENTICATION CHECK REPORT',
    '========================================',
    '',
    'CONFIGURATION STATUS:',
    `  Enabled: ${authCheck.enabled}`,
    `  Configured: ${authCheck.configured}`,
    `  Credentials Set: ${authCheck.credentialsSet}`,
    `  Base URL Valid: ${authCheck.baseUrlValid}`,
    '',
    'SETTINGS:',
    `  Region: ${authCheck.region}`,
    `  Language: ${authCheck.language}`,
    `  Timeout: ${authCheck.timeout}ms`,
    `  Max Requests/Month: ${authCheck.maxRequestsPerMonth}`,
    '',
    'ENDPOINTS:',
    ...endpoints.map(
      (ep) =>
        `  ${ep.path}: ${ep.description} (${ep.requestsPerSync} req/sync)`,
    ),
    '',
    'REQUEST BUDGET ESTIMATE:',
    `  Per Sync: ${budget.estimatedRequestsPerSync} requests`,
    `  Max Syncs/Month: ${budget.maxSyncsPerMonth}`,
    `  Syncs/Week: ~${budget.syncsPerWeek}`,
    `  Quota Limit: ${budget.quotaLimit}/month`,
    '',
  ];

  if (authCheck.issues.length > 0) {
    lines.push('ISSUES:');
    authCheck.issues.forEach((issue) => lines.push(`  ❌ ${issue}`));
    lines.push('');
  }

  if (authCheck.warnings.length > 0) {
    lines.push('WARNINGS:');
    authCheck.warnings.forEach((warning) => lines.push(`  ⚠️  ${warning}`));
    lines.push('');
  }

  if (authCheck.configured) {
    lines.push('STATUS: ✅ READY FOR API TESTING');
  } else {
    lines.push('STATUS: ❌ NOT READY - Fix issues above first');
  }

  lines.push('========================================');

  return lines.join('\n');
}
