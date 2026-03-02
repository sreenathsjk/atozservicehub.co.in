# AtoZServiceHub — Complete Deployment Guide

## 📱 EAS Build & Play Store / App Store Deployment

---

### STEP 1: Prerequisites

```bash
npm install -g eas-cli
eas login  # login with your Expo account
eas build:configure  # initializes EAS in project
```

---

### STEP 2: Android — Google Play Store

```bash
# 1. Build production AAB
cd mobile
eas build --platform android --profile production

# 2. Submit to Play Store (auto)
eas submit --platform android

# OR manually upload the .aab to:
# https://play.google.com/console → Create App → Release → Production
```

**Play Store Requirements:**
- App icon: 512×512 PNG
- Feature graphic: 1024×500
- Screenshots: Min 2 (phone), 10-char package name: `com.atozservicehub.app`
- Privacy policy URL required
- Content rating questionnaire
- Google Play Billing for subscriptions (iOS parity)

---

### STEP 3: iOS — App Store

```bash
# 1. Build IPA
eas build --platform ios --profile production

# 2. Submit to App Store Connect
eas submit --platform ios

# OR use Transporter app (macOS) to upload the .ipa
```

**App Store Requirements:**
- Apple Developer Account ($99/year)
- App Store Connect setup
- Privacy policy + terms of service
- Expo managed flow: `expo prebuild` for native code changes
- In-App Purchase setup via App Store Connect for subscriptions
- NSPhotoLibraryUsageDescription in Info.plist ✓

---

### STEP 4: Backend Deployment (Railway / Render / AWS)

```bash
# Option A: Railway
railway login
railway init
railway up

# Option B: Docker
docker build -t atozservicehub-api .
docker push your-registry/atozservicehub-api:latest

# Option C: AWS EC2
# Install Node.js 20, PostgreSQL, Redis
# Use PM2 for process management
pm2 start dist/index.js --name atozservicehub-api
pm2 save && pm2 startup
```

**Dockerfile (backend):**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
COPY prisma/ ./prisma/
RUN npx prisma generate
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

---

### STEP 5: Database (PostgreSQL)

```bash
# Neon (serverless PostgreSQL - recommended for production)
# https://neon.tech → Create DB → Copy connection string

# Run migrations
DATABASE_URL="..." npx prisma migrate deploy

# Seed admin user
ts-node prisma/seed.ts
```

**Seed script (prisma/seed.ts):**
```typescript
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
async function main() {
  await prisma.admin.upsert({
    where: { email: 'admin@atozservicehub.com' },
    update: {},
    create: {
      email: 'admin@atozservicehub.com',
      password: await bcrypt.hash('Admin@123!', 12),
      name: 'Super Admin',
      isSuperAdmin: true,
    },
  });
  console.log('✅ Seed complete');
}
main().catch(console.error).finally(() => prisma.$disconnect());
```

---

### STEP 6: Firebase Setup

1. Create Firebase project at console.firebase.google.com
2. Enable Phone Authentication
3. Download `google-services.json` → place in `mobile/`
4. Download `GoogleService-Info.plist` → place in `mobile/`
5. Download Service Account JSON → set as `FIREBASE_SERVICE_ACCOUNT` env var

---

### STEP 7: Razorpay Setup

1. Create account at razorpay.com
2. Get Test/Live key pair
3. Set webhook URL: `https://api.yourdomain.com/api/payments/webhook`
4. For iOS: Setup in-app purchase via App Store Connect (Razorpay wraps this)
5. Test with Razorpay test card: `4111 1111 1111 1111`

---

## ✅ Production Checklist

### Security
- [ ] JWT secrets are 64+ char random strings
- [ ] Aadhaar docs stored as `private` in Cloudinary
- [ ] Rate limiting enabled on all auth endpoints
- [ ] HTTPS enforced (SSL certificate)
- [ ] Input validation on all endpoints (Zod)
- [ ] SQL injection prevention (Prisma parameterized queries)
- [ ] Helmet.js security headers enabled

### Performance
- [ ] Database indexes on lat/lng, status, category
- [ ] Redis caching for feed responses (5-min TTL)
- [ ] Cloudinary image optimization (auto quality/format)
- [ ] CDN for API (Cloudflare)
- [ ] Horizontal scaling ready (stateless API)
- [ ] Connection pooling (PgBouncer or Prisma datasource URL)

### Monitoring
- [ ] Winston logging → centralized (Datadog/CloudWatch)
- [ ] Sentry error tracking (React Native + Node.js)
- [ ] Uptime monitoring (Better Uptime / Pingdom)
- [ ] Database backup schedule (daily)
- [ ] Grafana dashboard for API metrics

### Mobile
- [ ] Push notification channels configured (Android)
- [ ] APNs certificates uploaded to Firebase
- [ ] Deep linking tested
- [ ] Offline state handling
- [ ] EAS Update (OTA) configured for JS patches

### Business
- [ ] Razorpay KYC completed (for live payments)
- [ ] Privacy policy live at URL
- [ ] Terms of service live
- [ ] Google Play listing complete (screenshots, description, rating)
- [ ] App Store listing complete

---

## 🏗️ Scalability: 100,000+ Users

### Database Scaling
```sql
-- Add PostGIS for native geo queries (future)
CREATE EXTENSION postgis;
ALTER TABLE service_providers ADD COLUMN geom geometry(Point, 4326);
CREATE INDEX idx_providers_geom ON service_providers USING GIST(geom);

-- Partitioning bookings table by month
CREATE TABLE bookings_2025_01 PARTITION OF bookings
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
```

### Microservices Migration Path
```
Phase 1 (current):    Monolith API
Phase 2 (50k users):  Extract → NotificationService, PaymentService
Phase 3 (100k+):      Full microservices with API Gateway
                       Service mesh (Istio) for inter-service comms
```

### Caching Layer (Redis)
```typescript
// Cache feed for 5 minutes per lat/lng/category combo
const cacheKey = `feed:${Math.round(lat*10)/10}:${Math.round(lng*10)/10}:${category}:${page}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);
// ... fetch from DB ...
await redis.setEx(cacheKey, 300, JSON.stringify(result));
```

---

## 📁 Complete File Tree

```
AtoZServiceHub/
├── mobile/
│   ├── src/
│   │   ├── screens/
│   │   │   ├── auth/
│   │   │   │   ├── PhoneInputScreen.tsx
│   │   │   │   ├── OtpVerifyScreen.tsx
│   │   │   │   ├── RoleSelectScreen.tsx
│   │   │   │   └── OnboardingScreen.tsx
│   │   │   ├── customer/
│   │   │   │   ├── FeedScreen.tsx          ← Instagram feed
│   │   │   │   ├── ProviderDetailScreen.tsx
│   │   │   │   ├── CreateBookingScreen.tsx
│   │   │   │   ├── BookingsScreen.tsx
│   │   │   │   ├── BookingDetailScreen.tsx
│   │   │   │   ├── WriteReviewScreen.tsx
│   │   │   │   └── ProfileScreen.tsx
│   │   │   └── provider/
│   │   │       ├── DashboardScreen.tsx
│   │   │       ├── ProviderBookingsScreen.tsx
│   │   │       ├── ProviderBookingDetailScreen.tsx
│   │   │       ├── RegisterProviderScreen.tsx
│   │   │       └── ProviderProfileScreen.tsx
│   │   ├── components/
│   │   │   ├── cards/ProviderCard.tsx      ← Glassmorphism card
│   │   │   ├── common/CategoryFilter.tsx
│   │   │   └── modals/BookingModal.tsx
│   │   ├── navigation/
│   │   │   ├── AppNavigator.tsx
│   │   │   ├── CustomerNavigator.tsx
│   │   │   └── ProviderNavigator.tsx
│   │   ├── store/
│   │   │   ├── authStore.ts               ← Zustand auth
│   │   │   ├── feedStore.ts               ← Feed + pagination
│   │   │   └── locationStore.ts           ← Expo Location
│   │   ├── services/
│   │   │   ├── api.ts                     ← Axios + interceptors
│   │   │   └── notifications.ts           ← FCM setup
│   │   ├── utils/
│   │   │   └── haversine.ts               ← Distance calc
│   │   ├── types/index.ts
│   │   └── constants/index.ts
│   ├── app.json                           ← Expo config
│   └── eas.json                           ← Build profiles
│
├── backend/
│   ├── src/
│   │   ├── index.ts                       ← Express app
│   │   ├── routes/
│   │   │   ├── auth.routes.ts
│   │   │   ├── provider.routes.ts
│   │   │   ├── booking.routes.ts
│   │   │   ├── review.routes.ts
│   │   │   ├── payment.routes.ts
│   │   │   └── admin.routes.ts
│   │   ├── controllers/
│   │   │   ├── auth.controller.ts
│   │   │   ├── provider.controller.ts    ← Haversine feed
│   │   │   ├── booking.controller.ts
│   │   │   ├── review.controller.ts
│   │   │   ├── payment.controller.ts     ← Razorpay
│   │   │   └── admin.controller.ts
│   │   ├── middleware/
│   │   │   └── auth.middleware.ts        ← JWT + RBAC
│   │   ├── services/
│   │   │   └── notification.service.ts  ← FCM push
│   │   ├── config/
│   │   │   ├── cloudinary.ts
│   │   │   └── firebase.ts
│   │   └── utils/
│   │       ├── haversine.ts             ← Server-side distance
│   │       ├── jwt.ts
│   │       └── logger.ts
│   └── prisma/schema.prisma             ← Full DB schema
│
├── admin-dashboard/
│   └── index.html                       ← Standalone admin UI
│
└── docs/DEPLOYMENT.md                   ← This file
```
