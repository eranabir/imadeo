import { useLocalSearchParams, useRouter } from 'expo-router';
import { PlaceScreen } from '../../src/screens/PlaceScreen';
import { useServerUrl } from '../../src/session';

export default function Route() {
  const serverUrl = useServerUrl();
  const router = useRouter();
  const { city, title } = useLocalSearchParams<{ city: string; title?: string }>();

  return (
    <PlaceScreen
      serverUrl={serverUrl}
      city={city}
      title={title ?? city}
      slot={`place:${city}`}
      onBack={() => router.back()}
    />
  );
}
