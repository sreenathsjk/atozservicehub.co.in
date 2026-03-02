// backend/src/controllers/review.controller.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth.middleware';

const prisma = new PrismaClient();

export const createReview = async (req: AuthRequest, res: Response) => {
  try {
    const { bookingId, rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be 1-5' });
    }

    // Verify booking belongs to customer and is completed
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        customerId: req.user!.id,
        status: 'COMPLETED',
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found or not completed' });
    }

    // Prevent duplicate reviews
    const existing = await prisma.review.findUnique({
      where: { bookingId },
    });

    if (existing) {
      return res.status(400).json({ error: 'Review already submitted for this booking' });
    }

    const review = await prisma.review.create({
      data: {
        bookingId,
        customerId: req.user!.id,
        providerId: booking.providerId,
        rating: parseInt(rating),
        comment,
      },
    });

    // Recalculate avg rating
    const stats = await prisma.review.aggregate({
      where: { providerId: booking.providerId },
      _avg: { rating: true },
      _count: true,
    });

    await prisma.serviceProvider.update({
      where: { id: booking.providerId },
      data: {
        avgRating: stats._avg.rating || 0,
        totalReviews: stats._count,
      },
    });

    res.status(201).json(review);
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit review' });
  }
};

export const getProviderReviews = async (req: Request, res: Response) => {
  try {
    const { providerId } = req.params;
    const { page = '1' } = req.query as Record<string, string>;
    const PAGE_SIZE = 10;

    const reviews = await prisma.review.findMany({
      where: { providerId },
      include: {
        customer: { select: { name: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });

    res.json(reviews);
  } catch {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
};


// ─────────────────────────────────────────────
// backend/src/config/cloudinary.ts
// ─────────────────────────────────────────────
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const cloudinaryStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req: any, file: any) => {
    const isAadhaar = file.fieldname === 'aadhaarDoc';
    return {
      folder: isAadhaar ? 'atozservicehub/documents' : 'atozservicehub/profiles',
      allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'],
      transformation: isAadhaar ? [] : [{ width: 500, height: 500, crop: 'fill' }],
      // Aadhaar docs should be private
      ...(isAadhaar && { type: 'private' }),
    };
  },
});

export default cloudinary;


// ─────────────────────────────────────────────
// backend/src/config/firebase.ts
// ─────────────────────────────────────────────
import admin from 'firebase-admin';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export default admin;


// ─────────────────────────────────────────────
// backend/src/utils/logger.ts
// ─────────────────────────────────────────────
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});
