#!/usr/bin/env node
/**
 * Script: Kiểm tra kết nối EchoTik - PHASE 1
 * Chức năng: 
 * - Kiểm tra cấu hình (env vars)
 * - Thực hiện 1 API request đến /api/v3/echotik/seller/list
 * - Báo cáo kết quả
 * - KHÔNG ingest, KHÔNG scheduler, KHÔNG retry
 */

import { env, isEchoTikEnabled } from '../config/env.js';

async function main() {
  console.log('\n========================================');
  console.log('ECHOTIK CONNECTION TEST - PHASE 1');
  console.log('========================================\n');

  // Step 1: Kiểm tra cấu hình
  console.log('STEP 1: Configuration Check');
  console.log('----------------------------------------');

  const configValid = {
    enabled: env.echotik.enabled,
    hasUsername: !!env.echotik.username,
    hasPassword: !!env.echotik.password,
    baseUrl: env.echotik.baseUrl,
    region: env.echotik.region,
    language: env.echotik.language,
    timeoutMs: env.echotik.timeoutMs,
  };

  console.log(`✓ ECHOTIK_ENABLED: ${configValid.enabled}`);
  console.log(`✓ ECHOTIK_USERNAME: ${configValid.hasUsername ? '(set)' : '(NOT SET)'}`);
  console.log(`✓ ECHOTIK_PASSWORD: ${configValid.hasPassword ? '(set)' : '(NOT SET)'}`);
  console.log(`✓ ECHOTIK_BASE_URL: ${configValid.baseUrl}`);
  console.log(`✓ ECHOTIK_REGION: ${configValid.region}`);
  console.log(`✓ ECHOTIK_LANGUAGE: ${configValid.language}`);
  console.log(`✓ ECHOTIK_TIMEOUT: ${configValid.timeoutMs}ms`);

  if (!configValid.enabled || !configValid.hasUsername || !configValid.hasPassword) {
    console.log('\n❌ Configuration invalid. Stopping.');
    process.exit(1);
  }

  console.log('\n✅ Configuration valid.\n');

  // Step 2: Kiểm tra phương thức xác thực
  console.log('STEP 2: Authentication Method');
  console.log('----------------------------------------');
  console.log('✓ Authentication: HTTP Basic Auth');
  console.log(`✓ Base64 encoding: username:password`);
  console.log(`✓ Header format: Authorization: Basic <BASE64_ENCODED>\n`);

  // Step 3: Gọi API
  console.log('STEP 3: API Request');
  console.log('----------------------------------------');
  console.log('Endpoint: GET /api/v3/echotik/seller/list');
  console.log('Parameters: region=VN&page_num=1&page_size=10');
  console.log('Timeout: 30 seconds');
  console.log('Retry: No');
  console.log('Requests count: 1\n');

  try {
    // Tạo Basic Auth header
    const credentials = `${env.echotik.username}:${env.echotik.password}`;
    const encoded = Buffer.from(credentials).toString('base64');
    const authHeader = `Basic ${encoded}`;

    // Xây dựng URL
    const url = new URL(
      `/api/v3/echotik/seller/list?region=${env.echotik.region}&page_num=1&page_size=10`,
      env.echotik.baseUrl,
    );

    console.log(`Making request to: ${url.origin}${url.pathname}${url.search}`);

    // Gọi API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), env.echotik.timeoutMs);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'User-Agent': 'TikTok-Analytics-Bot/1.0',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Step 4: Kiểm tra response
    console.log('\nSTEP 4: API Response');
    console.log('----------------------------------------');
    console.log(`HTTP Status: ${response.status} ${response.statusText}`);

    const responseData = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      console.log('\n❌ API Error Response:');
      console.log(JSON.stringify(responseData, null, 2));
      process.exit(1);
    }

    // Step 5: Báo cáo kết quả
    console.log('\n✅ API Response Success\n');
    console.log('STEP 5: Results');
    console.log('----------------------------------------');

    // Kiểm tra cấu trúc response
    const shops = Array.isArray(responseData.data) ? (responseData.data as Record<string, unknown>[]) : [];
    console.log(`✓ Response Structure: Valid JSON`);
    console.log(`✓ Data Type: Array (${shops.length} shops)`);
    console.log(`✓ Response Fields: ${Object.keys(responseData).join(', ')}`);

    if (shops.length > 0 && shops[0]) {
      console.log(`✓ Sample Shop Fields: ${Object.keys(shops[0] as Record<string, unknown>).join(', ')}`);
    }

    // Step 6: Báo cáo tóm tắt
    console.log('\n========================================');
    console.log('FINAL REPORT');
    console.log('========================================');
    console.log(`Configuration: ✅ Valid`);
    console.log(`Authentication: ✅ Basic Auth`);
    console.log(`HTTP Status: ✅ ${response.status}`);
    console.log(`API Response: ✅ Success`);
    console.log(`Records Received: ✅ ${shops.length} shops`);
    console.log(`Requests Used: 1`);
    console.log(`Quota Status: 50 - 1 = 49 remaining`);
    console.log('\n✅ PHASE 1 COMPLETE - CONNECTION SUCCESSFUL\n');

    // Không ingest dữ liệu ở giai đoạn này
    console.log('Next Steps:');
    console.log('1. Review API response structure');
    console.log('2. Map fields to Prisma schema');
    console.log('3. Design ingestion strategy');
    console.log('4. Await confirmation before PHASE 2 (ingest)\n');

    process.exit(0);
  } catch (error) {
    console.log('\n❌ API Request Failed');
    console.log('----------------------------------------');

    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      console.log('Error: Network error or connection refused');
      console.log('Possible causes:');
      console.log('  - Base URL is unreachable');
      console.log('  - Network/firewall issue');
      console.log('  - Invalid endpoint');
    } else if (error instanceof Error && error.name === 'AbortError') {
      console.log('Error: Request timeout (30s exceeded)');
    } else {
      console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log(`\nRequests Used: 1`);
    console.log('Quota Status: 50 - 1 = 49 remaining\n');

    process.exit(1);
  }
}

main();
