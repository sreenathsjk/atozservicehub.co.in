// backend/src/routes/payment.routes.ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { createOrder, verifyPayment, getPaymentHistory, razorpayWebhook } from '../controllers/payment.controller';

const router = Router();

router.post('/create-order', authenticate, createOrder);
router.post('/verify', authenticate, verifyPayment);
router.get('/history', authenticate, getPaymentHistory);
router.post('/webhook', razorpayWebhook); // No auth, uses signature verification

export default router;


// ─────────────────────────────────────────────
// backend/src/controllers/payment.controller.ts
// ─────────────────────────────────────────────
import { Request, Response } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

// ─── Subscription Plans ───────────────────────────────────
const SUBSCRIPTION_PLANS = {
  BASIC: { amount: 49900, description: 'Basic Monthly Plan - ₹499/month' },
  PRO: { amount: 99900, description: 'Pro Monthly Plan - ₹999/month' },
  FEATURED: { amount: 199900, description: 'Featured Boost - ₹1,999/month' },
} as const;

// ─── Create Razorpay Order ────────────────────────────────
export const createOrder = async (req: AuthRequest, res: Response) => {
  try {
    const { type, bookingId, plan } = req.body;

    let amount: number;
    let description: string;

    if (type === 'SUBSCRIPTION' && plan) {
      const planConfig = SUBSCRIPTION_PLANS[plan as keyof typeof SUBSCRIPTION_PLANS];
      if (!planConfig) return res.status(400).json({ error: 'Invalid plan' });
      amount = planConfig.amount;
      description = planConfig.description;
    } else if (type === 'BOOKING' && bookingId) {
      const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!booking?.finalCost) return res.status(400).json({ error: 'Booking cost not set' });
      amount = Math.round(booking.finalCost * 100); // paise
      description = `Service booking payment`;
    } else {
      return res.status(400).json({ error: 'Invalid payment type' });
    }

    const order = await razorpay.orders.create({
      amount,
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      notes: { userId: req.user!.id, type, bookingId: bookingId || '' },
    });

    // Store pending payment
    const payment = await prisma.payment.create({
      data: {
        userId: req.user!.id,
        bookingId: bookingId || null,
        razorpayOrderId: order.id,
        amount: amount / 100,
        currency: 'INR',
        description,
        status: 'PENDING',
        metadata: { type, plan },
      },
    });

    res.json({
      orderId: order.id,
      amount,
      currency: 'INR',
      paymentId: payment.id,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    logger.error('createOrder error:', error);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
};

// ─── Verify Payment Signature ─────────────────────────────
export const verifyPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    // Verify Razorpay signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Update payment record
    const payment = await prisma.payment.update({
      where: { razorpayOrderId },
      data: {
        razorpayPaymentId,
        razorpaySignature,
        status: 'SUCCESS',
      },
    });

    // Handle subscription activation
    if ((payment.metadata as any)?.type === 'SUBSCRIPTION') {
      const plan = (payment.metadata as any)?.plan;
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      await prisma.serviceProvider.update({
        where: { userId: req.user!.id },
        data: {
          plan,
          planExpiresAt: expiresAt,
          isFeatured: plan === 'FEATURED',
          featuredUntil: plan === 'FEATURED' ? expiresAt : undefined,
        },
      });
    }

    res.json({ success: true, payment });
  } catch (error) {
    logger.error('verifyPayment error:', error);
    res.status(500).json({ error: 'Payment verification failed' });
  }
};

// ─── Razorpay Webhook ─────────────────────────────────────
export const razorpayWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-razorpay-signature'] as string;
    const body = JSON.stringify(req.body);

    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!)
      .update(body)
      .digest('hex');

    if (signature !== expectedSig) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const event = req.body.event;
    logger.info(`Razorpay webhook: ${event}`);

    if (event === 'payment.failed') {
      const orderId = req.body.payload.payment.entity.order_id;
      await prisma.payment.updateMany({
        where: { razorpayOrderId: orderId },
        data: { status: 'FAILED' },
      });
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('razorpayWebhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

export const getPaymentHistory = async (req: AuthRequest, res: Response) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(payments);
  } catch {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
};
