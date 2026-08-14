import { useRouter } from 'expo-router';
import { DevicesScreen } from '../src/screens/DevicesScreen';
import { useServerUrl } from '../src/session';

export default function Route() {
  const serverUrl = useServerUrl();
  const router = useRouter();
  return <DevicesScreen serverUrl={serverUrl} onBack={() => router.back()} />;
}
