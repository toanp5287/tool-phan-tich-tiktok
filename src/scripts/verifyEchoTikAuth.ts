#!/usr/bin/env node
/**
 * Script: Kiểm tra xác thực EchoTik
 * Dùng: npx ts-node src/scripts/verifyEchoTikAuth.ts
 * hoặc: node dist/scripts/verifyEchoTikAuth.js (sau build)
 *
 * Chức năng:
 * - Kiểm tra cấu hình credentials
 * - Kiểm tra Basic Auth header format
 * - Kiểm tra endpoint
 * - Ước tính request budget
 * - KHÔNG gọi API thật
 * - KHÔNG in credentials
 */

import {
  verifyEchoTikAuth,
  getEndpointInfo,
  estimateRequestBudget,
  generateAuthReport,
} from '../services/echotik/echoTikAuthVerifier.js';

async function main() {
  try {
    const report = generateAuthReport();
    console.log(report);

    const authCheck = verifyEchoTikAuth();

    // Exit code: 0 = ready, 1 = not ready
    process.exit(authCheck.configured ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Error during authentication check:', error);
    process.exit(1);
  }
}

main();
