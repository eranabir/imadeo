import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { faceThumbnail, thumbnail, type Person } from '../lib/api';
import { colors, radius, shadow, wash } from '../theme';
import { Icon } from './Icon';
import { Touchable } from './ui';

export const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** As much of a folder as its card needs. Search results carry no counts. */
export interface FolderCardData {
  name: string;
  color?: string | null;
  assetCount?: number;
  albumCount?: number;
  childCount?: number;
}

/** As much of an album as its card needs. Search results carry no cover. */
export interface AlbumCardData {
  id: string;
  name: string;
  assetCount: number;
  coverAssetId?: string | null;
  shared?: boolean;
}

/**
 * A folder, drawn as a folder rather than as its contents.
 *
 * Deliberately not given a cover photo: a folder is a place, and once it looks
 * like an album there is no way to tell at a glance which of the two you are
 * about to open — one of which can be nested and one of which cannot.
 */
export function FolderCard({
  folder,
  detail,
  onPress,
  onLongPress,
}: {
  folder: FolderCardData;
  /** Replaces the counts, for listings that do not return them. */
  detail?: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const inside = [
    folder.childCount ? count(folder.childCount, 'folder') : null,
    folder.albumCount ? count(folder.albumCount, 'album') : null,
    folder.assetCount === undefined ? null : count(folder.assetCount, 'photo'),
  ].filter(Boolean);

  const caption = detail ?? inside.join(' · ');

  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      radius={radius.md}
      label={folder.name}
      style={[{ backgroundColor: colors.surface }, shadow(1)]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 13,
          paddingVertical: 13,
          paddingHorizontal: 14,
        }}
      >
        {/* A tinted plate rather than a bare glyph: at this size a lone
            outline disappears into the card it sits on. */}
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.sm,
            backgroundColor: wash(colors.primary),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="folder" size={21} color={folder.color ?? colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15.5, fontWeight: '600' }}>
            {folder.name}
          </Text>
          {caption.length > 0 && (
            <Text numberOfLines={1} style={{ color: colors.faint, fontSize: 12.5, marginTop: 2 }}>
              {caption}
            </Text>
          )}
        </View>
        <Icon name="forward" size={16} color={colors.faint} />
      </View>
    </Touchable>
  );
}

/** An album, drawn as what is inside it. */
export function AlbumCard({
  serverUrl,
  album,
  token,
  onPress,
  onLongPress,
}: {
  serverUrl: string;
  album: AlbumCardData;
  token: string | null;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      label={album.name}
      radius={radius.md}
      style={{ flex: 1 }}
    >
      <View style={[{ aspectRatio: 1 }, shadow(1)]}>
        {/* The edge of a second card, so an album with more than one photo
            still looks like a collection when its cover happens to be plain. */}
        {album.assetCount > 1 && (
          <View
            style={{
              position: 'absolute',
              top: -4,
              left: 8,
              right: 8,
              height: 12,
              borderTopLeftRadius: 12,
              borderTopRightRadius: 12,
              backgroundColor: colors.border,
            }}
          />
        )}

        {album.coverAssetId ? (
          <Image
            source={thumbnail(serverUrl, album.coverAssetId, token)}
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 14,
              backgroundColor: colors.surface,
            }}
            contentFit="cover"
            recyclingKey={album.coverAssetId}
            transition={120}
          />
        ) : (
          <View
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 14,
              backgroundColor: colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="album" size={26} color={colors.faint} />
          </View>
        )}

        {album.shared && (
          <View
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: colors.overlay,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="shared" size={14} color="#fff" />
          </View>
        )}
      </View>

      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14.5, fontWeight: '600', marginTop: 8 }}>
        {album.name}
      </Text>
      <Text style={{ color: colors.faint, fontSize: 12.5, marginTop: 1, marginBottom: 4 }}>
        {count(album.assetCount, 'photo')}
      </Text>
    </Touchable>
  );
}

/**
 * A person or a pet, behind their face.
 *
 * Unnamed groups keep the circle and say how many photos they hold, because
 * that is the only thing distinguishing one anonymous cluster from the next —
 * and tapping through to see them is how someone decides whether to name it.
 */
export function PersonCard({
  serverUrl,
  person,
  token,
  size,
  onPress,
}: {
  serverUrl: string;
  person: Person;
  token: string | null;
  size: number;
  onPress: () => void;
}) {
  return (
    <Touchable
      onPress={onPress}
      label={person.name || 'Unnamed'}
      radius={radius.md}
      style={{ width: size }}
    >
      <Image
        source={faceThumbnail(serverUrl, person.id, token)}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.surface,
        }}
        contentFit="cover"
        recyclingKey={person.id}
        transition={140}
        // The crop is generated on first request, so a person viewed for the
        // very first time answers 404 until the server has made one.
        placeholderContentFit="cover"
      />
      <Text
        numberOfLines={1}
        style={{
          color: person.name ? colors.text : colors.faint,
          fontSize: 13.5,
          fontWeight: person.name ? '600' : '400',
          textAlign: 'center',
          marginTop: 7,
        }}
      >
        {person.name || 'Unnamed'}
      </Text>
      <Text
        style={{
          color: colors.faint,
          fontSize: 11.5,
          textAlign: 'center',
          marginTop: 1,
          marginBottom: 4,
        }}
      >
        {person.faceCount.toLocaleString()}
      </Text>
    </Touchable>
  );
}

/**
 * A titled run of cards.
 *
 * Childless is a real case: the last section on a browse screen labels the
 * photo grid, which the list renders itself rather than handing to a header.
 */
export function Section({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: string;
  children?: ReactNode;
}) {
  return (
    <View style={{ marginBottom: children ? 22 : 10 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          marginBottom: children ? 10 : 8,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 }}>
          {title}
        </Text>
        {trailing && <Text style={{ color: colors.faint, fontSize: 13 }}>{trailing}</Text>}
      </View>
      {children}
    </View>
  );
}
