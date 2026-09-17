import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { generateVerificationCode, sendVerificationEmail } from '../lib/email';
import { generateRefreshToken, hashRefreshToken, refreshTokenExpiry, signAccessToken } from '../lib/jwt';
import type { User } from '@prisma/client';

export const authRouter = Router();

const VERIFY_CODE_TTL_MS = 15 * 60 * 1000;

function toUserProfile(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified,
    photoUrl: user.photoUrl ?? undefined,
    conditions: user.conditions,
    allergies: user.allergies,
    emergencyContacts: [],
    language: 'en',
    reminderTimes: user.reminderTimes,
    notificationPrefs: user.notificationPrefs,
    escalation: user.escalation,
  };
}

async function issueSession(user: User) {
  const accessToken = signAccessToken(user.id);
  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hashRefreshToken(refreshToken), expiresAt: refreshTokenExpiry() },
  });
  return { tokens: { accessToken, refreshToken }, user: toUserProfile(user) };
}

const RegisterSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
});

authRouter.post('/register', async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid input' });
  const { name, email, password, phone } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return res.status(409).json({ message: 'An account with this email already exists' });

  const passwordHash = await bcrypt.hash(password, 12);
  const code = generateVerificationCode();

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      name,
      phone,
      passwordHash,
      verifyCode: code,
      verifyExpires: new Date(Date.now() + VERIFY_CODE_TTL_MS),
    },
  });

  await sendVerificationEmail(user.email, code).catch((err) => console.error('[auth] failed to send verification email:', err));

  res.status(201).json(await issueSession(user));
});

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid email or password' });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  res.json(await issueSession(user));
});

const VerifyEmailSchema = z.object({ email: z.string().email(), code: z.string().min(4) });

authRouter.post('/verify-email', async (req, res) => {
  const parsed = VerifyEmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid input' });
  const { email, code } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.verifyCode || !user.verifyExpires) {
    return res.status(400).json({ message: 'No verification pending for this email' });
  }
  if (user.verifyExpires < new Date()) return res.status(400).json({ message: 'This code has expired' });
  if (user.verifyCode !== code) return res.status(400).json({ message: 'Incorrect code' });

  const verified = await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, verifyCode: null, verifyExpires: null },
  });

  res.json(await issueSession(verified));
});

const ResendSchema = z.object({ email: z.string().email() });

authRouter.post('/resend-verification-code', async (req, res) => {
  const parsed = ResendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid email' });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  // Always return { sent: true } regardless of whether the account exists,
  // so this endpoint can't be used to enumerate registered emails.
  if (user && !user.emailVerified) {
    const code = generateVerificationCode();
    await prisma.user.update({
      where: { id: user.id },
      data: { verifyCode: code, verifyExpires: new Date(Date.now() + VERIFY_CODE_TTL_MS) },
    });
    await sendVerificationEmail(user.email, code).catch((err) => console.error('[auth] failed to resend code:', err));
  }

  res.json({ sent: true });
});

const RefreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post('/refresh', async (req, res) => {
  const parsed = RefreshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid input' });

  const tokenHash = hashRefreshToken(parsed.data.refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.expiresAt < new Date()) {
    return res.status(401).json({ message: 'Refresh token is invalid or expired' });
  }

  // Rotate: delete the used token, issue a new pair.
  await prisma.refreshToken.delete({ where: { id: stored.id } });
  const accessToken = signAccessToken(stored.userId);
  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { userId: stored.userId, tokenHash: hashRefreshToken(refreshToken), expiresAt: refreshTokenExpiry() },
  });

  res.json({ accessToken, refreshToken });
});

// Exported so other routers can build a UserProfile response the same way.
export { toUserProfile };
