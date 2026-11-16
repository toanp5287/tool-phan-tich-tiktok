import express, { type Application } from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import datasetRoutes from './routes/datasetRoutes.js';
import linkingRoutes from './routes/linkingRoutes.js';
import marketIntelligenceRoutes from './routes/marketIntelligenceRoutes.js';
import { errorHandler, notFoundHandler, sendSuccess } from './utils/http.js';
import { env } from './config/env.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const publicDir = path.resolve(currentDir, '../public');

export function createApp(): Application {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.set('json replacer', (_key: string, value: unknown) => typeof value === 'bigint' ? value.toString() : value);
  app.use(express.static(publicDir, { extensions: ['html'], maxAge: env.isProduction ? '1h' : 0 }));

  // Only the dataset router is loaded. Legacy readers and schedulers never enter this runtime.
  app.use('/api/market-intelligence', marketIntelligenceRoutes);
  app.use('/api', datasetRoutes);
  app.use('/api/linking', linkingRoutes);

  app.get('/', (_req, res) => {
    res.redirect('/app/');
  });

  // The Vue workspace uses History API routes under /app/*.
  // API routes remain registered above, so this never masks data endpoints.
  app.get(/^\/app(?:\/.*)?$/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'app', 'index.html'));
  });

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
