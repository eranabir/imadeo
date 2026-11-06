import { useRouter } from 'expo-router';
import { FavoritesScreen } from '../src/screens/FavoritesScreen';
import { useServerUrl } from '../src/session';

export default function Route() {
  const serverUrl = useServerUrl();
  const router = useRouter();
  return <FavoritesScreen serverUrl={serverUrl} onBack={() => router.back()} />;
}
