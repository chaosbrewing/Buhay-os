import { requireOptionalNativeModule } from 'expo';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  createDeviceAlarmService,
  type AlarmNative,
  type AlarmPermissions,
} from './device-alarms-core';

type NativeBridge = AlarmNative & {
  openAlarmSettingsAsync(): Promise<boolean>;
};

const osSupported = Platform.OS === 'android' ||
  (Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26);
// Do not import the package's eager requireNativeModule entry point: Expo Go must keep working.
const bridge = osSupported ? requireOptionalNativeModule<NativeBridge>('AlarmScheduler') : null;
export const alarmAvailability = {
  supported: Boolean(bridge),
  reason: Platform.OS === 'web'
    ? 'True device alarms are unavailable in the web app.'
    : !osSupported
      ? 'True alarms require iOS 26 or later. Older iPhones are not supported.'
      : !bridge
        ? 'Install a custom native development build. Expo Go cannot run true alarms.'
        : 'Native alarm support is available. Physical-device delivery still needs verification.',
};

// SecureStore encrypts metadata using the OS keychain/keystore. No planner text or passphrase
// is copied here. The native scheduler receives only a random ID, instant and generic title.
export const deviceAlarms = createDeviceAlarmService({
  get: (key) => Platform.OS === 'web' ? Promise.resolve(null) : SecureStore.getItemAsync(key),
  set: (key, value) => Platform.OS === 'web' ? Promise.resolve() : SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }),
  remove: (key) => Platform.OS === 'web' ? Promise.resolve() : SecureStore.deleteItemAsync(key),
}, bridge, () => Crypto.randomUUID());

export async function alarmPermissions(request = false): Promise<AlarmPermissions> {
  if (!bridge) throw new Error(alarmAvailability.reason);
  return request ? bridge.requestPermissionsAsync() : bridge.getPermissionsAsync();
}

export async function openAlarmSettings(): Promise<void> {
  if (!bridge || !await bridge.openAlarmSettingsAsync()) {
    throw new Error('Open the device settings app to manage alarm access.');
  }
}
