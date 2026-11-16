#!/usr/bin/env node

import prisma from '../config/db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('quota-check');

async function main() {
  try {
    const logs = await prisma.echoTikQuotaLog.findMany({
      orderBy: { month: 'desc' },
      take: 12,
    });

    logger.info('EchoTik Quota History (last 12 months):');
    logger.info('');
    
    if (logs.length === 0) {
      logger.info('No quota logs found.');
    } else {
      logs.forEach((log) => {
        logger.info(`Month: ${log.month} | Requests: ${log.count}/${50} | Reset: ${log.resetDate.toISOString()}`);
      });
    }

    const currentMonth = new Date().toISOString().slice(0, 7);
    const currentLog = logs.find((l) => l.month === currentMonth);
    
    logger.info('');
    if (currentLog) {
      logger.info(`Current Month (${currentMonth}): ${currentLog.count}/50 requests used`);
      logger.info(`Remaining: ${50 - currentLog.count} requests`);
    } else {
      logger.info(`Current Month (${currentMonth}): 0/50 requests used`);
      logger.info(`Remaining: 50 requests`);
    }

    process.exit(0);
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'unknown'}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
