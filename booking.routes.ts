// backend/src/routes/booking.routes.ts
import { Router } from 'express';
import { authenticate, requireProvider, requireCustomer } from '../middleware/auth.middleware';
import {
  createBooking,
  getMyBookings,
  updateBookingStatus,
  getBookingById,
} from '../controllers/booking.controller';

const router = Router();

router.post('/', authenticate, requireCustomer, createBooking);
router.get('/my', authenticate, getMyBookings);
router.get('/:id', authenticate, getBookingById);
router.patch('/:id/status', authenticate, requireProvider, updateBookingStatus);

export default router;


// ─────────────────────────────────────────────
// backend/src/controllers/booking.controller.ts
// ─────────────────────────────────────────────
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth.middleware';
import { sendPushNotification } from '../services/notification.service';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

// ─── Create Booking ───────────────────────────────────────
export const createBooking = async (req: AuthRequest, res: Response) => {
  try {
    const { providerId, serviceDate, serviceTime, address, latitude, longitude, description } = req.body;

    // Check provider exists and is approved
    const provider = await prisma.serviceProvider.findFirst({
      where: { id: providerId, status: 'APPROVED' },
      include: { user: true },
    });

    if (!provider) {
      return res.status(404).json({ error: 'Provider not found or not approved' });
    }

    // Spam prevention: max 3 pending bookings per customer
    const pendingCount = await prisma.booking.count({
      where: {
        customerId: req.user!.id,
        status: 'PENDING',
      },
    });

    if (pendingCount >= 3) {
      return res.status(429).json({ error: 'Too many pending bookings. Wait for existing ones to be resolved.' });
    }

    const booking = await prisma.booking.create({
      data: {
        customerId: req.user!.id,
        providerId,
        serviceDate: new Date(serviceDate),
        serviceTime,
        address,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        description,
        status: 'PENDING',
      },
      include: {
        customer: { select: { name: true, phone: true } },
        provider: { include: { user: true } },
      },
    });

    // Notify provider
    if (provider.user.fcmToken) {
      await sendPushNotification(
        provider.user.fcmToken,
        '📅 New Booking Request',
        `${booking.customer.name || 'A customer'} wants to book your service on ${serviceDate}`,
        { bookingId: booking.id, type: 'NEW_BOOKING' }
      );
    }

    res.status(201).json(booking);
  } catch (error) {
    logger.error('createBooking error:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
};

// ─── Get My Bookings ──────────────────────────────────────
export const getMyBookings = async (req: AuthRequest, res: Response) => {
  try {
    const { role } = req.user!;
    const { status, page = '1' } = req.query as Record<string, string>;

    const PAGE_SIZE = 20;
    const skip = (parseInt(page) - 1) * PAGE_SIZE;

    let bookings;
    if (role === 'CUSTOMER') {
      bookings = await prisma.booking.findMany({
        where: {
          customerId: req.user!.id,
          ...(status && { status: status as any }),
        },
        include: {
          provider: {
            include: { user: { select: { name: true, avatar: true } } },
          },
          review: true,
          payment: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: PAGE_SIZE,
      });
    } else {
      // PROVIDER
      const provider = await prisma.serviceProvider.findUnique({
        where: { userId: req.user!.id },
      });
      if (!provider) return res.status(404).json({ error: 'Provider profile not found' });

      bookings = await prisma.booking.findMany({
        where: {
          providerId: provider.id,
          ...(status && { status: status as any }),
        },
        include: {
          customer: { select: { id: true, name: true, phone: true, avatar: true } },
          review: true,
          payment: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: PAGE_SIZE,
      });
    }

    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
};

// ─── Update Booking Status (Provider) ────────────────────
export const updateBookingStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason, finalCost } = req.body;

    const provider = await prisma.serviceProvider.findUnique({
      where: { userId: req.user!.id },
    });

    const booking = await prisma.booking.findFirst({
      where: { id, providerId: provider?.id },
      include: { customer: true },
    });

    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const validTransitions: Record<string, string[]> = {
      PENDING: ['ACCEPTED', 'REJECTED'],
      ACCEPTED: ['IN_PROGRESS', 'CANCELLED'],
      IN_PROGRESS: ['COMPLETED'],
    };

    if (!validTransitions[booking.status]?.includes(status)) {
      return res.status(400).json({
        error: `Cannot transition from ${booking.status} to ${status}`,
      });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        status,
        ...(rejectionReason && { rejectionReason }),
        ...(finalCost && { finalCost: parseFloat(finalCost) }),
      },
    });

    // Update provider stats
    if (status === 'COMPLETED') {
      await prisma.serviceProvider.update({
        where: { id: provider!.id },
        data: { totalBookings: { increment: 1 } },
      });
    }

    // Notify customer
    const statusMessages: Record<string, { title: string; body: string }> = {
      ACCEPTED: { title: '✅ Booking Accepted!', body: 'Your service request has been accepted.' },
      REJECTED: { title: '❌ Booking Rejected', body: rejectionReason || 'Your request was not accepted.' },
      IN_PROGRESS: { title: '🔧 Service Started', body: 'The provider is now working.' },
      COMPLETED: { title: '🎉 Service Completed!', body: 'Please rate your experience.' },
    };

    if (booking.customer.fcmToken && statusMessages[status]) {
      await sendPushNotification(
        booking.customer.fcmToken,
        statusMessages[status].title,
        statusMessages[status].body,
        { bookingId: id, type: 'BOOKING_UPDATE', status }
      );
    }

    res.json(updated);
  } catch (error) {
    logger.error('updateBookingStatus error:', error);
    res.status(500).json({ error: 'Failed to update booking' });
  }
};

export const getBookingById = async (req: AuthRequest, res: Response) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, name: true, phone: true, avatar: true } },
        provider: { include: { user: { select: { name: true, avatar: true, phone: true } } } },
        review: true,
        payment: true,
      },
    });

    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    // Auth check: only involved parties
    const provider = await prisma.serviceProvider.findUnique({
      where: { userId: req.user!.id },
    });

    const isCustomer = booking.customerId === req.user!.id;
    const isProvider = provider?.id === booking.providerId;

    if (!isCustomer && !isProvider && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(booking);
  } catch {
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
};
