import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../lib/jwt';

export type AuthedRequest = Request & { userId: string };

/** Verifies the Bearer access token exactly as lib/api/client.ts sends it. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Missing access token' });

  try {
    const payload = verifyAccessToken(token);
    (req as AuthedRequest).userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired access token' });
  }
}
