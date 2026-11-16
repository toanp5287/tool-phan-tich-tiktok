#!/usr/bin/env node
/**
 * Script: Kiểm thử API EchoTik (PHASE A)
 * Chức năng: Gọi 5 endpoint, kiểm tra schema, KHÔNG ingest
 * 
 * Dùng: npm run build && LOG_LEVEL=error node dist/scripts/testEchoTikApiPhaseA.js
 */

import { EchoTikApiTester } from '../services/echotik/echoTikApiTester.js';

async function main() {
  try {
    console.log('\n');
    console.log('========================================');
    console.log('ECHOTIK API TEST - PHASE A');
    console.log('(Schema Verification - NO Ingestion)');
    console.log('========================================');
    console.log('\n');

    const tester = new EchoTikApiTester();
    const summary = await tester.runAllTests();

    // Print results
    console.log('TEST RESULTS:\n');
    console.log(`Total Requests Used: ${summary.totalRequests}`);
    console.log(`Total Records Received: ${summary.totalRecords}`);
    console.log(`Quota Before: ${summary.quotaBefore}`);
    console.log(`Quota After: ${summary.quotaAfter}`);
    console.log(`Quota Used: ${summary.quotaUsed}\n`);

    console.log('ENDPOINT SUMMARY:');
    console.log('----------------------------------------');
    for (const result of summary.results) {
      const status = result.success ? '✅ SUCCESS' : '❌ FAILED';
      console.log(`${status}: ${result.endpoint}`);
      console.log(`  Records: ${result.recordsReceived}, Requests: ${result.requestsUsed}`);
      if (result.unverifiedFields.length > 0) {
        console.log(`  Unverified: ${result.unverifiedFields.join(', ')}`);
      }
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
      console.log();
    }

    console.log('========================================');
    console.log('PHASE A COMPLETE - Ready for PHASE B');
    console.log('(Await confirmation before ingestion)');
    console.log('========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.log('\n========================================');
    console.log('PHASE A FAILED');
    console.log('========================================\n');
    process.exit(1);
  }
}

main();
