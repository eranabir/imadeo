import { useLocalSearchParams, useRouter } from 'expo-router';
import { BrowseScreen } from '../../src/screens/BrowseScreen';
import { useServerUrl } from '../../src/session';

/**
 * A folder is Browse, pointed at something narrower.
 *
 * The same screen renders both, which is why the tab and this route share a
 * component rather than duplicating a grid, a selection and a create dialog.
 */
export default function Route() {
  const serverUrl = useServerUrl();
  const router = useRouter();
  const { id, title, locked } = useLocalSearchParams<{ id: string; title?: string; locked?: string }>();

  return (
    <BrowseScreen
      serverUrl={serverUrl}
      folderId={id}
      title={title}
      locked={locked === '1'}
      onBack={() => router.back()}
    />
  );
}
