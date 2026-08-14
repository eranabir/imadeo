import { useLocalSearchParams, useRouter } from 'expo-router';
import { DeviceLibraryScreen } from '../../src/screens/DevicesScreen';
import { useServerUrl } from '../../src/session';

export default function Route() {
  const serverUrl = useServerUrl();
  const router = useRouter();
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();

  return (
    <DeviceLibraryScreen
      serverUrl={serverUrl}
      deviceId={id}
      title={title ?? 'Device Library'}
      onBack={() => router.back()}
    />
  );
}
