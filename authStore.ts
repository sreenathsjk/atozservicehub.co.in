// mobile/src/store/authStore.ts
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { User, ServiceProvider } from '../types';

interface AuthStore {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  provider: ServiceProvider | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  setAuth: (data: {
    accessToken: string;
    refreshToken: string;
    user: User;
    provider?: ServiceProvider | null;
  }) => Promise<void>;
  updateUser: (user: Partial<User>) => void;
  updateProvider: (provider: Partial<ServiceProvider>) => void;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  provider: null,
  isLoading: true,
  isAuthenticated: false,

  setAuth: async ({ accessToken, refreshToken, user, provider }) => {
    await SecureStore.setItemAsync('accessToken', accessToken);
    await SecureStore.setItemAsync('refreshToken', refreshToken);
    await SecureStore.setItemAsync('user', JSON.stringify(user));
    if (provider) {
      await SecureStore.setItemAsync('provider', JSON.stringify(provider));
    }
    set({ accessToken, refreshToken, user, provider: provider || null, isAuthenticated: true });
  },

  updateUser: (updates) => {
    const current = get().user;
    if (!current) return;
    const updated = { ...current, ...updates };
    set({ user: updated });
    SecureStore.setItemAsync('user', JSON.stringify(updated));
  },

  updateProvider: (updates) => {
    const current = get().provider;
    const updated = current ? { ...current, ...updates } : (updates as ServiceProvider);
    set({ provider: updated });
    SecureStore.setItemAsync('provider', JSON.stringify(updated));
  },

  logout: async () => {
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
    await SecureStore.deleteItemAsync('user');
    await SecureStore.deleteItemAsync('provider');
    set({ accessToken: null, refreshToken: null, user: null, provider: null, isAuthenticated: false });
  },

  loadFromStorage: async () => {
    try {
      const [accessToken, refreshToken, userStr, providerStr] = await Promise.all([
        SecureStore.getItemAsync('accessToken'),
        SecureStore.getItemAsync('refreshToken'),
        SecureStore.getItemAsync('user'),
        SecureStore.getItemAsync('provider'),
      ]);

      if (accessToken && userStr) {
        const user = JSON.parse(userStr);
        const provider = providerStr ? JSON.parse(providerStr) : null;
        set({ accessToken, refreshToken, user, provider, isAuthenticated: true });
      }
    } catch (e) {
      console.error('Failed to load auth from storage:', e);
    } finally {
      set({ isLoading: false });
    }
  },
}));


// ─────────────────────────────────────────────
// mobile/src/store/locationStore.ts
// ─────────────────────────────────────────────
import { create } from 'zustand';
import * as Location from 'expo-location';

interface LocationStore {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  hasPermission: boolean;
  isLoading: boolean;
  requestLocation: () => Promise<boolean>;
  setLocation: (lat: number, lng: number) => void;
}

export const useLocationStore = create<LocationStore>((set) => ({
  latitude: null,
  longitude: null,
  city: null,
  hasPermission: false,
  isLoading: false,

  requestLocation: async () => {
    set({ isLoading: true });
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        set({ hasPermission: false, isLoading: false });
        return false;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude } = location.coords;

      // Reverse geocode for city name
      let city = null;
      try {
        const [geo] = await Location.reverseGeocodeAsync({ latitude, longitude });
        city = geo?.city || geo?.district || null;
      } catch {}

      set({ latitude, longitude, city, hasPermission: true, isLoading: false });
      return true;
    } catch (error) {
      set({ isLoading: false });
      return false;
    }
  },

  setLocation: (latitude, longitude) => set({ latitude, longitude }),
}));


// ─────────────────────────────────────────────
// mobile/src/store/feedStore.ts
// ─────────────────────────────────────────────
import { create } from 'zustand';
import { ServiceProvider, ServiceCategory } from '../types';
import { api } from '../services/api';

interface FeedStore {
  providers: ServiceProvider[];
  page: number;
  hasMore: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  selectedCategory: ServiceCategory | null;
  
  fetchProviders: (lat: number, lng: number, refresh?: boolean) => Promise<void>;
  setCategory: (category: ServiceCategory | null) => void;
  loadMore: (lat: number, lng: number) => Promise<void>;
}

export const useFeedStore = create<FeedStore>((set, get) => ({
  providers: [],
  page: 1,
  hasMore: true,
  isLoading: false,
  isRefreshing: false,
  selectedCategory: null,

  fetchProviders: async (lat, lng, refresh = false) => {
    if (refresh) {
      set({ isRefreshing: true, page: 1 });
    } else {
      set({ isLoading: true });
    }

    try {
      const { selectedCategory } = get();
      const params: Record<string, string> = {
        lat: String(lat),
        lng: String(lng),
        page: '1',
        maxRadius: '50',
      };
      if (selectedCategory) params.category = selectedCategory;

      const response = await api.get('/providers/feed', { params });
      const { providers, hasMore } = response.data;

      set({
        providers,
        hasMore,
        page: 1,
        isLoading: false,
        isRefreshing: false,
      });
    } catch (error) {
      set({ isLoading: false, isRefreshing: false });
    }
  },

  loadMore: async (lat, lng) => {
    const { page, hasMore, isLoading, selectedCategory } = get();
    if (!hasMore || isLoading) return;

    set({ isLoading: true });
    const nextPage = page + 1;

    try {
      const params: Record<string, string> = {
        lat: String(lat),
        lng: String(lng),
        page: String(nextPage),
        maxRadius: '50',
      };
      if (selectedCategory) params.category = selectedCategory;

      const response = await api.get('/providers/feed', { params });
      const { providers: newProviders, hasMore: more } = response.data;

      set((state) => ({
        providers: [...state.providers, ...newProviders],
        page: nextPage,
        hasMore: more,
        isLoading: false,
      }));
    } catch {
      set({ isLoading: false });
    }
  },

  setCategory: (category) => {
    set({ selectedCategory: category, providers: [], page: 1, hasMore: true });
  },
}));
