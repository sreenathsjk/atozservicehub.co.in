// mobile/src/services/api.ts
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const BASE_URL = Constants.expoConfig?.extra?.apiUrl || 'http://localhost:3000/api';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Request Interceptor: Inject Auth Token ──────────────
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── Response Interceptor: Auto Token Refresh ────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = await SecureStore.getItemAsync('refreshToken');
        if (!refreshToken) throw new Error('No refresh token');

        const response = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        const { accessToken, refreshToken: newRefresh } = response.data;

        await SecureStore.setItemAsync('accessToken', accessToken);
        await SecureStore.setItemAsync('refreshToken', newRefresh);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch {
        // Logout user
        await SecureStore.deleteItemAsync('accessToken');
        await SecureStore.deleteItemAsync('refreshToken');
        // Trigger navigation to auth screen via event or store
      }
    }

    return Promise.reject(error);
  }
);

// ─── Typed API Calls ─────────────────────────────────────

export const authAPI = {
  sendOtp: (phone: string) => api.post('/auth/send-otp', { phone }),
  verifyOtp: (phone: string, firebaseIdToken: string) =>
    api.post('/auth/verify-otp', { phone, firebaseIdToken }),
  logout: () => api.post('/auth/logout'),
};

export const providerAPI = {
  getFeed: (lat: number, lng: number, category?: string, page = 1) =>
    api.get('/providers/feed', { params: { lat, lng, category, page } }),
  getById: (id: string) => api.get(`/providers/${id}`),
  register: (data: FormData) =>
    api.post('/providers/register', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  updateProfile: (data: FormData) =>
    api.put('/providers/profile', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  toggleAvailability: (isOnline: boolean, lat?: number, lng?: number) =>
    api.patch('/providers/availability', { isOnline, latitude: lat, longitude: lng }),
  updateFcmToken: (fcmToken: string) =>
    api.patch('/providers/fcm-token', { fcmToken }),
};

export const bookingAPI = {
  create: (data: object) => api.post('/bookings', data),
  getMyBookings: (status?: string, page = 1) =>
    api.get('/bookings/my', { params: { status, page } }),
  getById: (id: string) => api.get(`/bookings/${id}`),
  updateStatus: (id: string, status: string, extras?: object) =>
    api.patch(`/bookings/${id}/status`, { status, ...extras }),
};

export const reviewAPI = {
  create: (data: object) => api.post('/reviews', data),
  getProviderReviews: (providerId: string, page = 1) =>
    api.get(`/reviews/provider/${providerId}`, { params: { page } }),
};

export const paymentAPI = {
  createOrder: (data: object) => api.post('/payments/create-order', data),
  verifyPayment: (data: object) => api.post('/payments/verify', data),
  getHistory: () => api.get('/payments/history'),
};
