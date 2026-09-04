import { useLocalSearchParams, useRouter } from 'expo-router';
import { AlbumScreen } from '../../src/screens/AlbumScreen';
import { useServerUrl } from '../../src/session';

export default function Route() {
  const serverUrl = useServerUrl();
  const router = useRouter();
  const { id, title, locked } = useLocalSearchParams<{ id: string; title?: string; locked?: string }>();

  return (
    <AlbumScreen
      serverUrl={serverUrl}
      albumId={id}
      title={title ?? 'Album'}
      locked={locked === '1'}
      onBack={() => router.back()}
    />
  );
}
