// backend/src/routes/auth.routes.ts
import { Router } from 'express';
import { sendOtp, verifyOtp, refreshToken, logout } from '../controllers/auth.controller';

const router = Router();

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/refresh', refreshToken);
router.post('/logout', logout);

export default router;


// ─────────────────────────────────────────────
// backend/src/controllers/auth.controller.ts
// ─────────────────────────────────────────────
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import admin from 'firebase-admin';
import { generateTokens } from '../utils/jwt';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

// Send OTP via Firebase Auth
export const sendOtp = async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;

    if (!phone || !/^\+[1-9]\d{9,14}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    // Firebase client handles OTP delivery; server just acknowledges
    // For server-side OTP (alternative):
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

    await prisma.otpSession.create({
      data: { phone, otp, expiresAt },
    });

    // In production: send via SMS (Twilio/MSG91)
    // For Firebase Auth flow, client sends directly; skip this
    logger.info(`OTP generated for ${phone}`);

    res.json({ message: 'OTP sent successfully', ...(process.env.NODE_ENV === 'development' && { otp }) });
  } catch (error) {
    logger.error('sendOtp error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
};

// Verify Firebase ID Token OR custom OTP
export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const { phone, firebaseIdToken, otp } = req.body;

    let verifiedPhone = phone;

    if (firebaseIdToken) {
      // Firebase Auth flow
      const decoded = await admin.auth().verifyIdToken(firebaseIdToken);
      verifiedPhone = decoded.phone_number;
    } else if (otp) {
      // Custom OTP flow
      const session = await prisma.otpSession.findFirst({
        where: {
          phone,
          otp,
          verified: false,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!session) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
      }

      await prisma.otpSession.update({
        where: { id: session.id },
        data: { verified: true },
      });
    } else {
      return res.status(400).json({ error: 'Provide firebaseIdToken or otp' });
    }

    // Upsert user
    const user = await prisma.user.upsert({
      where: { phone: verifiedPhone },
      update: { updatedAt: new Date() },
      create: { phone: verifiedPhone },
      include: { provider: true },
    });

    const { accessToken, refreshToken } = generateTokens(user.id);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        role: user.role,
        avatar: user.avatar,
        provider: user.provider,
        isNewUser: !user.name,
      },
    });
  } catch (error) {
    logger.error('verifyOtp error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const { refreshToken: token } = req.body;
    const jwt = await import('jsonwebtoken');
    const decoded = jwt.default.verify(token, process.env.JWT_REFRESH_SECRET!) as any;
    const { accessToken, refreshToken: newRefresh } = generateTokens(decoded.userId);
    res.json({ accessToken, refreshToken: newRefresh });
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
};

export const logout = async (req: Request, res: Response) => {
  // Invalidate FCM token
  res.json({ message: 'Logged out successfully' });
};
