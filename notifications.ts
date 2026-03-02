// mobile/src/services/notifications.ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { providerAPI } from './api';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('Must use physical device for push notifications');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('bookings', {
      name: 'Booking Notifications',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6C63FF',
      sound: 'default',
    });

    await Notifications.setNotificationChannelAsync('updates', {
      name: 'General Updates',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const token = await Notifications.getExpoPushTokenAsync({
    projectId: 'YOUR_EAS_PROJECT_ID',
  });

  return token.data;
}

export function setupNotificationListeners(
  onNotification: (notification: Notifications.Notification) => void,
  onResponse: (response: Notifications.NotificationResponse) => void
) {
  const notifListener = Notifications.addNotificationReceivedListener(onNotification);
  const responseListener = Notifications.addNotificationResponseReceivedListener(onResponse);

  return () => {
    Notifications.removeNotificationSubscription(notifListener);
    Notifications.removeNotificationSubscription(responseListener);
  };
}

export async function updateFcmTokenOnServer(token: string) {
  try {
    await providerAPI.updateFcmToken(token);
  } catch (e) {
    console.error('Failed to update FCM token:', e);
  }
}
