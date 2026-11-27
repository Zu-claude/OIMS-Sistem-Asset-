import express from 'express';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { initDatabase } from './server/db';
import { registerRoutes } from './server/routes';
import { generateMysqlDump } from './server/mysql-export';

dotenv.config();

async function startServer() {
  initDatabase();

  // Keep an up-to-date physical oims.sql file in /database/oims.sql for XAMPP/phpMyAdmin handover
  const dbExportDir = path.resolve(process.cwd(), 'database');
  if (!fs.existsSync(dbExportDir)) {
    fs.mkdirSync(dbExportDir, { recursive: true });
  }
  fs.writeFileSync(path.join(dbExportDir, 'oims.sql'), generateMysqlDump(), 'utf8');

  const app = express();
  const PORT = 3000;

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  // Basic origin check on mutating API calls
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.headers.origin;
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (origin && host) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            res.status(403).json({ error: 'Cross-origin mutation blocked' });
            return;
          }
        } catch {
          res.status(403).json({ error: 'Invalid Origin header' });
          return;
        }
      }
    }
    next();
  });

  registerRoutes(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`KIDECO OIMS Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start OIMS server:', err);
  process.exit(1);
});
