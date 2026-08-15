import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { AssetGrid, useSelection } from '../components/AssetGrid';
import { HeaderAction, useHeaderClearance } from '../components/Header';
import { useHeaderSlot } from '../header';
import { Icon } from '../components/Icon';
import { PhotoActions } from '../components/PhotoActions';
import { request, usePagedResource, type Asset } from '../lib/api';
import { colors } from '../theme';

interface Props {
  /** Where this screen publishes its bar. */
  slot: string;
  serverUrl: string;
  subjectId: string;
  title: string;
  /** Whether the server has this grouped with the people or with the pets. */
  kind: 'PERSON' | 'PET';
  /** Kept even when a recognised dog or cat is moved to People. */
  species: string | null;
  onBack: () => void;
}

/** Every photo one person or pet appears in. */
export function SubjectScreen({ serverUrl, subjectId, title, kind, species, slot, onBack }: Props) {
  const [name, setName] = useState(title === 'Unnamed' ? '' : title);
  const [naming, setNaming] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Held locally so the header answers the press before the server does. */
  const [is, setIs] = useState(kind);

  /**
   * Moves this group between People and Pets.
   *
   * Detection decides which of the two something is, and it gets it wrong — a
   * dog photographed face-on lands among the people often enough that there had
   * to be a way to say so. Nothing else changes; the faces, the name and the
   * cover all go with it.
   */
  const swapKind = async () => {
    const next = is === 'PET' ? 'PERSON' : 'PET';
    setIs(next);
    setSaveError(null);
    try {
      await request(serverUrl, `/people-and-pets/${subjectId}`, {
        method: 'PUT',
        body: JSON.stringify({ kind: next }),
      });
    } catch (e) {
      // Put back what was there: the group did not move.
      setIs(is);
      setSaveError(e instanceof Error ? e.message : 'Could not move this group.');
    }
  };

  const { items, pagination, token, error, loading, reload, hasMore, loadingMore, loadMore } = usePagedResource<Asset>(
    serverUrl,
    `/people-and-pets/${subjectId}/assets`,
  );
  const clearance = useHeaderClearance();
  const selection = useSelection();

  const total = pagination?.total ?? 0;

  // Published rather than drawn: the shell owns the one bar, and a screen that
  // brought its own would slide it in over the top of the one already there.
  useHeaderSlot(
    slot,
    {
      title: name || 'Unnamed',
      subtitle: total
        ? `${species ? `${species} · ` : ''}${total.toLocaleString()} ${total === 1 ? 'item' : 'items'}`
        : species ?? undefined,
      icon: is === 'PET' ? 'pet' : 'person',
      onBack,
      action: (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <HeaderAction
            label={is === 'PET' ? 'This is a person' : 'This is a pet'}
            icon={is === 'PET' ? 'person' : 'pet'}
            compact
            // No confirmation: it is one tap to undo, and the label already
            // says which way it goes.
            onPress={() => void swapKind()}
          />
          <HeaderAction
            label={name ? 'Rename' : 'Add name'}
            icon="edit"
            onPress={() => setNaming(true)}
          />
        </View>
      ),
    },
    [name, total, is, onBack],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AssetGrid
        serverUrl={serverUrl}
        assets={items}
        token={token}
        loading={loading}
        onRefresh={reload}
        topInset={clearance}
        header={
          error || saveError ? (
            <Text style={{ color: colors.danger, fontSize: 14, padding: 16 }}>
              {error ?? saveError}
            </Text>
          ) : null
        }
        selected={selection.ids}
        onToggle={selection.toggle}
        onStartSelecting={selection.start}
        onChanged={reload}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        emptyIcon="person"
        emptyTitle={loading ? 'Loading…' : 'No media'}
        emptyBody="The faces that made up this group are no longer in your library."
      />

      <PhotoActions
        serverUrl={serverUrl}
        ids={selection.ids}
        allFavorite={
          selection.ids.length > 0 &&
          selection.ids.every((id) => items.find((a) => a.id === id)?.isFavorite)
        }
        onClear={selection.clear}
        onDone={() => {
          selection.clear();
          reload();
        }}
      />

      {naming && (
        <NameSheet
          initial={name}
          onCancel={() => setNaming(false)}
          onSave={async (next) => {
            // Named locally before the request settles: nothing else on this
            // screen depends on the response, and waiting would leave the
            // header saying "Unnamed" through a round trip on a home
            // connection. Put back if the server refuses, so the name that is
            // shown is always the name that was stored.
            const previous = name;
            setName(next);
            setNaming(false);
            setSaveError(null);
            try {
              await request(serverUrl, `/people-and-pets/${subjectId}`, {
                method: 'PUT',
                body: JSON.stringify({ name: next }),
              });
            } catch (e) {
              setName(previous);
              setSaveError(e instanceof Error ? e.message : 'That name could not be saved.');
            }
          }}
        />
      )}
    </View>
  );
}

/**
 * Naming a face, without `Alert.prompt`.
 *
 * That would have been one line, and iOS-only — Android has no equivalent, so
 * the single most useful thing on this screen would have been missing on half
 * the devices the app runs on.
 */
function NameSheet({
  initial,
  onCancel,
  onSave,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [focused, setFocused] = useState(false);

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      {/* Tapping away is how a sheet is dismissed on both platforms. */}
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 28,
        }}
      >
        {/* Swallows the press so tapping the card itself does not close it. */}
        <Pressable
          onPress={() => {}}
          style={{
            width: '100%',
            maxWidth: 380,
            backgroundColor: colors.surface,
            borderRadius: 22,
            padding: 22,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Icon name="person" size={20} color={colors.primary} />
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', letterSpacing: -0.3 }}>
              Who is this?
            </Text>
          </View>

          <TextInput
            value={value}
            onChangeText={setValue}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Name"
            placeholderTextColor={colors.faint}
            autoFocus
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => onSave(value.trim())}
            style={{
              color: colors.text,
              fontSize: 17,
              paddingHorizontal: 16,
              paddingVertical: 13,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: focused ? colors.primary : colors.border,
              backgroundColor: colors.bg,
            }}
          />

          <Text style={{ color: colors.faint, fontSize: 13, lineHeight: 19, marginTop: 12 }}>
            Naming a group keeps it visible however few photos it has, and lets
            you search for it by name.
          </Text>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 13,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ color: colors.text, fontSize: 15.5, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onSave(value.trim())}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 13,
                borderRadius: 999,
                backgroundColor: colors.primary,
                alignItems: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: '#04211d', fontSize: 15.5, fontWeight: '700' }}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
