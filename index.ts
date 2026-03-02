// backend/src/index.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';

import authRoutes from './routes/auth.routes';
import providerRoutes from './routes/provider.routes';
import customerRoutes from './routes/customer.routes';
import bookingRoutes from './routes/booking.routes';
import reviewRoutes from './routes/review.routes';
import paymentRoutes from './routes/payment.routes';
import adminRoutes from './routes/admin.routes';
import uploadRoutes from './routes/upload.routes';
import { errorHandler } from './middleware/error.middleware';
import { logger } from './utils/logger';

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security Middleware ───────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));

// ─── Rate Limiting ────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: { error: 'Too many auth attempts, please wait.' },
});

app.use('/api/', globalLimiter);
app.use('/api/auth/', authLimiter);

// ─── Body Parser ──────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ─────────────────────────────
app.get('/health', (_, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);

// ─── Error Handler ────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`🚀 AtoZServiceHub API running on port ${PORT}`);
});

export default app;
