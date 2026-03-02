// backend/src/routes/provider.routes.ts
import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireProvider, requireCustomer } from '../middleware/auth.middleware';
import {
  registerProvider,
  updateProfile,
  toggleAvailability,
  getFeedProviders,
  getProviderById,
  updateFcmToken,
} from '../controllers/provider.controller';
import { cloudinaryStorage } from '../config/cloudinary';

const router = Router();
const upload = multer({ storage: cloudinaryStorage });

// Public
router.get('/feed', authenticate, requireCustomer, getFeedProviders);
router.get('/:id', authenticate, getProviderById);

// Provider only
router.post('/register', authenticate, upload.fields([
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'aadhaarDoc', maxCount: 1 },
]), registerProvider);
router.put('/profile', authenticate, requireProvider, upload.single('profilePhoto'), updateProfile);
router.patch('/availability', authenticate, requireProvider, toggleAvailability);
router.patch('/fcm-token', authenticate, updateFcmToken);

export default router;


// ─────────────────────────────────────────────
// backend/src/controllers/provider.controller.ts
// ─────────────────────────────────────────────
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { haversineDistance } from '../utils/haversine';
import { AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

const FEED_PAGE_SIZE = 10;

// ─── Customer Feed: Nearest Approved Providers ───────────
export const getFeedProviders = async (req: AuthRequest, res: Response) => {
  try {
    const {
      lat,
      lng,
      category,
      page = '1',
      maxRadius = '50',
    } = req.query as Record<string, string>;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Location required' });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const pageNum = parseInt(page);
    const radius = parseFloat(maxRadius);

    // Bounding box pre-filter for performance (before Haversine)
    // 1 degree lat ≈ 111km
    const latDelta = radius / 111;
    const lngDelta = radius / (111 * Math.cos((userLat * Math.PI) / 180));

    const providers = await prisma.serviceProvider.findMany({
      where: {
        status: 'APPROVED',
        isOnline: true,
        ...(category && { category: category as any }),
        latitude: {
          gte: userLat - latDelta,
          lte: userLat + latDelta,
        },
        longitude: {
          gte: userLng - lngDelta,
          lte: userLng + lngDelta,
        },
      },
      include: {
        user: {
          select: { id: true, name: true, phone: true, avatar: true },
        },
      },
      orderBy: [
        { isFeatured: 'desc' },
        { avgRating: 'desc' },
      ],
    });

    // Apply precise Haversine filter + sort by distance
    const withDistance = providers
      .map((p) => ({
        ...p,
        distance: haversineDistance(userLat, userLng, p.latitude, p.longitude),
      }))
      .filter((p) => p.distance <= Math.min(p.serviceRadius, radius))
      .sort((a, b) => {
        // Featured first, then by distance
        if (a.isFeatured && !b.isFeatured) return -1;
        if (!a.isFeatured && b.isFeatured) return 1;
        return a.distance - b.distance;
      });

    // Pagination
    const startIdx = (pageNum - 1) * FEED_PAGE_SIZE;
    const paginated = withDistance.slice(startIdx, startIdx + FEED_PAGE_SIZE);
    const hasMore = withDistance.length > startIdx + FEED_PAGE_SIZE;

    res.json({
      providers: paginated,
      page: pageNum,
      hasMore,
      total: withDistance.length,
    });
  } catch (error) {
    logger.error('getFeedProviders error:', error);
    res.status(500).json({ error: 'Failed to fetch providers' });
  }
};

// ─── Register as Provider ─────────────────────────────────
export const registerProvider = async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Record<string, Express.Multer.File[]>;
    const {
      category, serviceRadius, latitude, longitude,
      experience, whatsappNumber, description, businessName, address, city,
    } = req.body;

    const profilePhoto = files?.profilePhoto?.[0]?.path;
    const aadhaarDoc = files?.aadhaarDoc?.[0]?.path;

    const existing = await prisma.serviceProvider.findUnique({
      where: { userId: req.user!.id },
    });

    if (existing) {
      return res.status(400).json({ error: 'Provider profile already exists' });
    }

    const provider = await prisma.$transaction(async (tx) => {
      const p = await tx.serviceProvider.create({
        data: {
          userId: req.user!.id,
          category,
          serviceRadius: parseFloat(serviceRadius),
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          experience: parseInt(experience) || 0,
          whatsappNumber,
          description,
          businessName,
          address,
          city,
          profilePhoto,
          aadhaarDoc,
          status: 'PENDING',
        },
      });

      await tx.user.update({
        where: { id: req.user!.id },
        data: { role: 'PROVIDER' },
      });

      return p;
    });

    res.status(201).json({
      message: 'Registration submitted. Pending admin approval.',
      provider,
    });
  } catch (error) {
    logger.error('registerProvider error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

// ─── Toggle Online/Offline ────────────────────────────────
export const toggleAvailability = async (req: AuthRequest, res: Response) => {
  try {
    const { isOnline, latitude, longitude } = req.body;

    const provider = await prisma.serviceProvider.update({
      where: { userId: req.user!.id },
      data: {
        isOnline,
        ...(latitude && longitude && {
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
        }),
      },
    });

    res.json({ isOnline: provider.isOnline });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update availability' });
  }
};

// ─── Update FCM Token ─────────────────────────────────────
export const updateFcmToken = async (req: AuthRequest, res: Response) => {
  try {
    const { fcmToken } = req.body;
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { fcmToken },
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to update FCM token' });
  }
};

// ─── Get Provider by ID ───────────────────────────────────
export const getProviderById = async (req: Request, res: Response) => {
  try {
    const provider = await prisma.serviceProvider.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { name: true, phone: true, avatar: true } },
        reviews: {
          include: { customer: { select: { name: true, avatar: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!provider) return res.status(404).json({ error: 'Provider not found' });
    res.json(provider);
  } catch {
    res.status(500).json({ error: 'Failed to fetch provider' });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { description, serviceRadius, experience, address, city } = req.body;
    const profilePhoto = (req.file as any)?.path;

    const provider = await prisma.serviceProvider.update({
      where: { userId: req.user!.id },
      data: {
        description,
        serviceRadius: serviceRadius ? parseFloat(serviceRadius) : undefined,
        experience: experience ? parseInt(experience) : undefined,
        address,
        city,
        ...(profilePhoto && { profilePhoto }),
      },
    });

    res.json(provider);
  } catch {
    res.status(500).json({ error: 'Failed to update profile' });
  }
};
