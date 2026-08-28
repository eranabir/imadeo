import { useRouter } from 'expo-router';
import { LockedScreen } from '../src/screens/LockedScreen';
import { useServerUrl } from '../src/session';

export default function Route() {
  const router = useRouter();
  const serverUrl = useServerUrl();
  return <LockedScreen serverUrl={serverUrl} onBack={() => router.back()} />;
}
