import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { AssetGrid, useSelection } from '../components/AssetGrid';
import { Header, HeaderAction, useHeaderClearance } from '../components/Header';
import { Icon } from '../components/Icon';
import { PhotoActions } from '../components/PhotoActions';
import { request, useResource, type Asset, type Paged } from '../lib/api';
import { colors } from '../theme';

interface Props {
  serverUrl: string;
  personId: string;
  title: string;
  onBack: () => void;
}

/** Every photo one person or pet appears in. */
export function PersonScreen({ serverUrl, personId, title, onBack }: Props) {
  const [name, setName] = useState(title === 'Unnamed' ? '' : title);
  const [naming, setNaming] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, token, error, loading, reload } = useResource<Paged<Asset>>(
    serverUrl,
    `/people/${personId}/assets?size=500`,
  );
  const clearance = useHeaderClearance();
  const selection = useSelection();

  const total = data?.pagination?.total ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header
        title={name || 'Unnamed'}
        subtitle={total ? `${total.toLocaleString()} ${total === 1 ? 'photo' : 'photos'}` : undefined}
        icon="person"
       
        onBack={onBack}
        action={
          <HeaderAction
            label={name ? 'Rename' : 'Add name'}
            icon="edit"
           
            onPress={() => setNaming(true)}
          />
        }
      />

      <AssetGrid
        serverUrl={serverUrl}
        assets={data?.items ?? []}
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
        emptyIcon="person"
        emptyTitle={loading ? 'Loading…' : 'No photos'}
        emptyBody="The faces that made up this group are no longer in your library."
      />

      <PhotoActions
        serverUrl={serverUrl}
        ids={selection.ids}
        allFavorite={
          selection.ids.length > 0 &&
          selection.ids.every((id) => data?.items.find((a) => a.id === id)?.isFavorite)
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
              await request(serverUrl, `/people/${personId}`, {
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
