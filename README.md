# AtoZServiceHub — Production Architecture

> Hyperlocal Service Marketplace | React Native + Node.js + PostgreSQL

---

## 📁 Project Structure

```
AtoZServiceHub/
├── mobile/                    # React Native + Expo app
│   ├── src/
│   │   ├── screens/           # App screens by role
│   │   ├── components/        # Reusable UI components
│   │   ├── navigation/        # React Navigation config
│   │   ├── store/             # Zustand state management
│   │   ├── hooks/             # Custom hooks
│   │   ├── services/          # API + Firebase services
│   │   ├── utils/             # Haversine, formatters
│   │   ├── types/             # TypeScript interfaces
│   │   └── constants/         # App constants
│   ├── app.json               # Expo config
│   ├── eas.json               # EAS Build config
│   └── package.json
│
├── backend/                   # Node.js + Express API
│   ├── src/
│   │   ├── controllers/       # Route handlers
│   │   ├── routes/            # Express routes
│   │   ├── middleware/        # Auth, rate limit, validation
│   │   ├── services/          # Business logic
│   │   ├── utils/             # Helpers
│   │   └── prisma/            # Schema + migrations
│   ├── .env.example
│   └── package.json
│
├── admin-dashboard/           # React web dashboard
│   └── src/
│       ├── components/
│       ├── pages/
│       └── services/
│
└── docs/                      # Architecture docs
```

---

## 🚀 Quick Start

```bash
# Backend
cd backend && npm install && npx prisma migrate dev && npm run dev

# Mobile
cd mobile && npm install && npx expo start

# Admin Dashboard  
cd admin-dashboard && npm install && npm run dev
```
