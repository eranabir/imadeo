import { requireNativeModule } from 'expo-modules-core';
import { Alert } from 'react-native';

let sharing = false;

export async function shareLibraryPhotos(ids: readonly string[]) {
  if (sharing || ids.length === 0) return;
  sharing = true;
  try {
    const photos = requireNativeModule<{ shareLibraryPhotos(ids: readonly string[]): Promise<void> }>('ImadeoViewerButton');
    await photos.shareLibraryPhotos(ids);
  } catch (error) {
    Alert.alert('Could not share', error instanceof Error ? error.message : 'Please try again.');
  } finally {
    sharing = false;
  }
}
