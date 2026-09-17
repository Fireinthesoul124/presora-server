import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;
const fromAddress = process.env.EMAIL_FROM || 'Presora <onboarding@resend.dev>';

const resend = apiKey ? new Resend(apiKey) : null;

export function generateVerificationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Sends the 6-digit verification code from FR-1.1.3 (OTP-based verification).
 * If RESEND_API_KEY isn't set yet, the code is logged instead of emailed so
 * local development and testing aren't blocked on having an email account.
 */
export async function sendVerificationEmail(to: string, code: string) {
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — verification code for ${to} is: ${code}`);
    return;
  }

  await resend.emails.send({
    from: fromAddress,
    to,
    subject: 'Your Presora verification code',
    text: `Your verification code is ${code}. It expires in 15 minutes.`,
    html: `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in 15 minutes.</p>`,
  });
}
