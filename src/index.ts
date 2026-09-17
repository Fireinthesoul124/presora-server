import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { authRouter } from './routes/auth';
import { prescriptionsRouter } from './routes/prescriptions';

const app = express();

app.use(helmet());
app.use(cors());
// Images arrive as base64 in the JSON body (not multipart — see the client's
// lib/imageEncoding.ts for why), so the default 100kb limit is far too small.
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/prescriptions', prescriptionsRouter);

// Centralized error handler — anything an async route forgot to catch lands
// here as a generic 500 instead of crashing the process.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled]', err);
  res.status(500).json({ message: 'Internal server error' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Presora server listening on :${port}`);
});
