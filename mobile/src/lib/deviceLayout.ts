import * as Device from 'expo-device';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { usesRegularIPhoneHeader } from './layout';

const nativeModel = Platform.OS === 'ios'
  ? requireOptionalNativeModule<{ deviceModelIdentifier?: string }>('ImadeoBrowseTabs')?.deviceModelIdentifier
  : undefined;

/** Hardware identity is stable when the Duo folds or its window resizes. */
export const isRegularIPhone = Platform.OS === 'ios' &&
  usesRegularIPhoneHeader(nativeModel ?? Device.modelId);
