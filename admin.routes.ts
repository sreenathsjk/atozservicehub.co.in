// backend/src/routes/admin.routes.ts
import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.middleware';
import {
  getDashboard,
  getPendingProviders,
  approveProvider,
  rejectProvider,
  getAllUsers,
  getAllBookings,
  getAllPayments,
  adminLogin,
} from '../controllers/admin.controller';

const router = Router();

router.post('/login', adminLogin);
router.use(authenticate, requireAdmin);

router.get('/dashboard', getDashboard);
router.get('/providers/pending', getPendingProviders);
router.patch('/providers/:id/approve', approveProvider);
router.patch('/providers/:id/reject', rejectProvider);
router.get('/users', getAllUsers);
router.get('/bookings', getAllBookings);
router.get('/payments', getAllPayments);

export default router;


// ─────────────────────────────────────────────
// backend/src/controllers/admin.controller.ts
// ─────────────────────────────────────────────
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/auth.middleware';
import { sendPushNotification } from '../services/notification.service';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

export const adminLogin = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin || !await bcrypt.compare(password, admin.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: admin.id, role: 'ADMIN' },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    );

    res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name } });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
};

export const getDashboard = async (req: Request, res: Response) => {
  try {
    const [
      totalUsers, totalProviders, pendingProviders,
      totalBookings, completedBookings,
      totalRevenue,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.serviceProvider.count(),
      prisma.serviceProvider.count({ where: { status: 'PENDING' } }),
      prisma.booking.count(),
      prisma.booking.count({ where: { status: 'COMPLETED' } }),
      prisma.payment.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
      }),
    ]);

    // Monthly revenue (last 6 months)
    const monthlyRevenue = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', "createdAt") as month,
        SUM(amount) as revenue
      FROM payments
      WHERE status = 'SUCCESS'
        AND "createdAt" > NOW() - INTERVAL '6 months'
      GROUP BY month
      ORDER BY month
    `;

    res.json({
      stats: {
        totalUsers,
        totalProviders,
        pendingProviders,
        totalBookings,
        completedBookings,
        totalRevenue: totalRevenue._sum.amount || 0,
      },
      monthlyRevenue,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
};

export const getPendingProviders = async (req: Request, res: Response) => {
  try {
    const providers = await prisma.serviceProvider.findMany({
      where: { status: 'PENDING' },
      include: { user: { select: { name: true, phone: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(providers);
  } catch {
    res.status(500).json({ error: 'Failed to fetch pending providers' });
  }
};

export const approveProvider = async (req: Request, res: Response) => {
  try {
    const provider = await prisma.serviceProvider.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED' },
      include: { user: true },
    });

    if (provider.user.fcmToken) {
      await sendPushNotification(
        provider.user.fcmToken,
        '🎉 Profile Approved!',
        'Your service provider profile has been approved. You can now receive bookings!',
        { type: 'PROVIDER_APPROVED' }
      );
    }

    res.json({ message: 'Provider approved', provider });
  } catch {
    res.status(500).json({ error: 'Failed to approve provider' });
  }
};

export const rejectProvider = async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    const provider = await prisma.serviceProvider.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED' },
      include: { user: true },
    });

    if (provider.user.fcmToken) {
      await sendPushNotification(
        provider.user.fcmToken,
        '❌ Profile Not Approved',
        reason || 'Your provider profile was not approved. Please contact support.',
        { type: 'PROVIDER_REJECTED' }
      );
    }

    res.json({ message: 'Provider rejected' });
  } catch {
    res.status(500).json({ error: 'Failed to reject provider' });
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const { page = '1', search } = req.query as Record<string, string>;
    const PAGE_SIZE = 50;
    const skip = (parseInt(page) - 1) * PAGE_SIZE;

    const users = await prisma.user.findMany({
      where: search ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      } : undefined,
      include: { provider: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: PAGE_SIZE,
    });

    const total = await prisma.user.count();
    res.json({ users, total, page: parseInt(page) });
  } catch {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

export const getAllBookings = async (req: Request, res: Response) => {
  try {
    const { page = '1', status } = req.query as Record<string, string>;
    const PAGE_SIZE = 50;

    const bookings = await prisma.booking.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        customer: { select: { name: true, phone: true } },
        provider: { include: { user: { select: { name: true } } } },
        payment: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });

    res.json(bookings);
  } catch {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
};

export const getAllPayments = async (req: Request, res: Response) => {
  try {
    const payments = await prisma.payment.findMany({
      include: { user: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(payments);
  } catch {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
};


// ─────────────────────────────────────────────
// backend/src/services/notification.service.ts
// ─────────────────────────────────────────────
import admin from 'firebase-admin';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const sendPushNotification = async (
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
) => {
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: data ? Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ) : undefined,
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'bookings' },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    });
  } catch (error) {
    console.error('Push notification failed:', error);
  }
};

export const sendBulkNotification = async (
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, string>
) => {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, fcmToken: { not: null } },
    select: { fcmToken: true },
  });

  const tokens = users.map((u) => u.fcmToken!).filter(Boolean);

  if (tokens.length === 0) return;

  await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data,
  });
};


// ─────────────────────────────────────────────
// backend/src/routes/review.routes.ts
// ─────────────────────────────────────────────
import { Router } from 'express';
import { authenticate, requireCustomer } from '../middleware/auth.middleware';
import { createReview, getProviderReviews } from '../controllers/review.controller';

const router = Router();

router.post('/', authenticate, requireCustomer, createReview);
router.get('/provider/:providerId', getProviderReviews);

export default router;
