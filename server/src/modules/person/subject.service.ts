import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { dirname } from 'node:path';
import type { AppConfig } from '../../config/configuration';
import { AssetType, AssetVisibility, Prisma, SourceType } from '../../db';
import { SubjectKind } from '../../db';
import { MediaService } from '../../infra/media/media.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import type { SubjectQueryDto, UpdateSubjectDto } from './person.dto';

@Injectable()
export class SubjectService {
  private readonly logger = new Logger(SubjectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // -- reads ----------------------------------------------------------------

  /**
   * People and pets in the library, most-photographed first.
   *
   * Unnamed groups with only a face or two are hidden by default: early on,
   * clustering produces a long tail of one-off detections (a stranger in the
   * background, a face on a poster) and showing them all buries the people who
   * actually matter.
   */
  async list(userId: string, query: SubjectQueryDto = {}) {
    /**
     * Two independent filters that used to be one.
     *
     * `withHidden` is about people someone chose to hide; `minFaces` is about
     * groups too small to be worth showing yet. Tying them together meant the
     * only way to see a two-face group was to also un-hide everyone previously
     * dismissed — and, worse, that a small group could never be selected, so it
     * could never be merged into the right person.
     */
    const minimum =
      query.minFaces ?? this.config.get('machineLearning.faceMinCount', { infer: true });

    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        birthDate: Date | null;
        thumbnailPath: string;
        isHidden: boolean;
        isFavorite: boolean;
        kind: string;
        species: string | null;
        thumbnailUpdatedAt: Date;
        faceCount: bigint;
      }[]
    >`
      SELECT
        p.id, p.name, p."birthDate", p."thumbnailPath", p."updatedAt" AS "thumbnailUpdatedAt", p."isHidden", p."isFavorite",
        p.kind, p.species,
        COUNT(f.id)::bigint AS "faceCount"
      FROM people p
      JOIN asset_faces f ON f."personId" = p.id AND f."deletedAt" IS NULL
      JOIN assets a ON a.id = f."assetId"
        AND a."deletedAt" IS NULL
        AND a.visibility <> 'LOCKED'
      WHERE p."ownerId" = ${userId}::uuid
        ${query.withHidden ? Prisma.empty : Prisma.sql`AND p."isHidden" = false`}
        ${query.kind ? Prisma.sql`AND p.kind = ${query.kind}::"SubjectKind"` : Prisma.empty}
      GROUP BY p.id
      -- A named person is always worth showing, however few photos they have.
      HAVING COUNT(f.id) >= ${minimum} OR p.name <> ''
      ORDER BY p."isFavorite" DESC, (p.name <> '') DESC, COUNT(f.id) DESC
      LIMIT ${Math.min(500, query.size ?? 200)}
    `;

    return rows.map(({ faceCount, ...person }) => ({
      ...person,
      faceCount: Number(faceCount),
      hasName: person.name !== '',
    }));
  }

  async get(userId: string, personId: string) {
    const person = await this.prisma.person.findFirst({
      where: { id: personId, ownerId: userId },
      include: {
        _count: {
          select: {
            // A group can keep its historical detections after a photo goes to
            // Trash. The detail header must count the same active photos as
            // the grid, otherwise it says a dog has photos that are nowhere on
            // the page and makes the grouping look corrupted.
            faces: {
              where: {
                deletedAt: null,
                asset: {
                  deletedAt: null,
                  visibility: { in: [AssetVisibility.TIMELINE, AssetVisibility.ARCHIVE] },
                },
              },
            },
          },
        },
      },
    });
    if (!person) throw new NotFoundException('Person not found');

    const { _count, ...rest } = person;
    return { ...rest, faceCount: _count.faces };
  }

  /** Every photo this person appears in. */
  async getAssets(userId: string, personId: string, page = 1, size = 250) {
    await this.get(userId, personId);

    const where: Prisma.AssetWhereInput = {
      ownerId: userId,
      deletedAt: null,
      visibility: { in: [AssetVisibility.TIMELINE, AssetVisibility.ARCHIVE] },
      faces: { some: { personId, deletedAt: null } },
    };

    const [items, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        include: {
          exif: true,
          // Only this person's detections. The client needs the face id to say
          // "that is not them" — a photo can hold several faces, and detaching
          // the wrong one would remove a different person from their own page.
          faces: { where: { personId, deletedAt: null }, select: { id: true } },
        },
        orderBy: [{ localDateTime: 'desc' }],
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.asset.count({ where }),
    ]);

    return { items, pagination: { page, size, total } };
  }

  // -- writes ---------------------------------------------------------------

  async update(userId: string, personId: string, dto: UpdateSubjectDto) {
    await this.get(userId, personId);

    return this.prisma.person.update({
      where: { id: personId },
      data: {
        name: dto.name?.trim(),
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        isHidden: dto.isHidden,
        isFavorite: dto.isFavorite,
        color: dto.color,
        kind: dto.kind,
      },
    });
  }

  /**
   * Folds several matching subjects into one.
   *
   * Every face moves rather than being re-detected, and the surviving person
   * keeps whichever name is already set — merging "Anna" into an unnamed group
   * should not lose the name.
   */
  async merge(userId: string, targetId: string, sourceIds: string[]) {
    const target = await this.get(userId, targetId);
    const requestedSourceIds = sourceIds.filter((id) => id !== targetId);

    const sources = await this.prisma.person.findMany({
      where: { id: { in: requestedSourceIds }, ownerId: userId },
    });
    if (sources.length === 0) throw new BadRequestException('Nothing to merge');
    if (sources.some((person) => person.kind !== target.kind)) {
      throw new BadRequestException('People and pets cannot be merged');
    }

    const namedSource = sources.find((person) => person.name !== '');

    const result = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.assetFace.updateMany({
        where: { personId: { in: sources.map((s) => s.id) } },
        data: { personId: targetId },
      });

      // Keep a name if one exists anywhere in the group being merged.
      if (target.name === '' && namedSource) {
        await tx.person.update({
          where: { id: targetId },
          data: { name: namedSource.name, birthDate: namedSource.birthDate },
        });
      }

      await tx.person.deleteMany({ where: { id: { in: sources.map((s) => s.id) } } });

      return moved.count;
    });

    // Old thumbnails belong to subjects that no longer exist.
    await this.storage.removeMany(sources.map((s) => s.thumbnailPath || null));

    return { mergedInto: targetId, subjects: sources.length, detections: result };
  }

  /**
   * Detaches faces from a person, e.g. when clustering put the wrong face in.
   *
   * The detached faces are pinned so re-clustering will not quietly put them
   * back where the person just took them out of.
   */
  async detachFaces(userId: string, personId: string, faceIds: string[]) {
    await this.get(userId, personId);

    const { count } = await this.prisma.assetFace.updateMany({
      where: { id: { in: faceIds }, personId, asset: { ownerId: userId } },
      data: { personId: null, isPinned: true },
    });

    return { detached: count };
  }

  /**
   * The detections sitting inside a set of photos.
   *
   * Ownership is checked through the asset rather than trusted from the client,
   * so this cannot be used to enumerate someone else's library.
   */
  async facesInAssets(userId: string, assetIds: string[]) {
    return this.prisma.assetFace.findMany({
      where: { assetId: { in: assetIds }, deletedAt: null, asset: { ownerId: userId } },
      select: { id: true, assetId: true, kind: true, species: true, personId: true },
      orderBy: [{ score: 'desc' }],
    });
  }

  /**
   * Links whole photos to a person or pet by hand.
   *
   * Detection is not a precondition. When the models found something of the
   * right kind in a photo, that detection is moved onto the subject; when they
   * found nothing — a pet the detector missed, someone facing away — a manual
   * full-frame entry is created instead. Without this, "this is my dog" is
   * impossible to say precisely when the recognition has already failed, which
   * is the one moment it matters.
   *
   * Manual entries carry no embedding on purpose: they are a human statement,
   * not evidence, and letting them steer clustering would spread one mistake
   * across the library.
   */
  async attachAssets(userId: string, personId: string, assetIds: string[]) {
    const person = await this.get(userId, personId);

    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds }, ownerId: userId, deletedAt: null },
      select: {
        id: true,
        exif: { select: { exifImageWidth: true, exifImageHeight: true } },
        faces: { where: { deletedAt: null }, select: { id: true, kind: true, personId: true } },
      },
    });

    let moved = 0;
    let created = 0;

    for (const asset of assets) {
      if (asset.faces.some((face) => face.personId === personId)) continue;

      // Prefer an unclaimed detection of the right kind over inventing one.
      const free = asset.faces.find(
        (face) => face.kind === person.kind && face.personId === null,
      );

      if (free) {
        await this.prisma.assetFace.update({
          where: { id: free.id },
          data: { personId, isPinned: true, sourceType: SourceType.MANUAL },
        });
        moved++;
        continue;
      }

      const width = asset.exif?.exifImageWidth ?? 0;
      const height = asset.exif?.exifImageHeight ?? 0;

      await this.prisma.assetFace.create({
        data: {
          assetId: asset.id,
          personId,
          kind: person.kind,
          species: person.species,
          // The whole frame: nothing was detected, so there is no box to record.
          boundingBoxX1: 0,
          boundingBoxY1: 0,
          boundingBoxX2: width,
          boundingBoxY2: height,
          imageWidth: width,
          imageHeight: height,
          score: 1,
          sourceType: SourceType.MANUAL,
          isPinned: true,
        },
      });
      created++;
    }

    return { moved, created, total: moved + created };
  }

  /** Starts a new person or pet, for a face the automatic grouping missed. */
  async create(userId: string, name: string, kind: SubjectKind = SubjectKind.PERSON) {
    return this.prisma.person.create({
      data: { ownerId: userId, name: name.trim(), kind },
      select: {
        id: true,
        name: true,
        kind: true,
        species: true,
        thumbnailPath: true,
        isHidden: true,
        isFavorite: true,
      },
    });
  }

  /** Moves specific faces onto another person — the fix for a bad merge. */
  async reassignFaces(userId: string, faceIds: string[], personId: string) {
    await this.get(userId, personId);

    const { count } = await this.prisma.assetFace.updateMany({
      where: { id: { in: faceIds }, asset: { ownerId: userId } },
      // Pinned so automatic clustering respects the decision.
      data: { personId, isPinned: true, sourceType: SourceType.MANUAL },
    });

    return { reassigned: count };
  }

  async remove(userId: string, personId: string) {
    const result = await this.removeMany(userId, [personId]);
    if (result.removed === 0) throw new NotFoundException('Person or pet not found');
    return { successful: true };
  }

  async removeMany(userId: string, personIds: string[]) {
    const ids = [...new Set(personIds)];
    const people = await this.prisma.person.findMany({
      where: { id: { in: ids }, ownerId: userId },
      select: { id: true, thumbnailPath: true },
    });
    if (people.length !== ids.length) throw new NotFoundException('Some people or pets were not found');

    // Deleting a subject only releases its detections for future clustering;
    // the original photos and detections remain untouched.
    await this.prisma.person.deleteMany({ where: { id: { in: ids }, ownerId: userId } });
    await this.storage.removeMany(people.map((person) => person.thumbnailPath || null));

    return { removed: people.length };
  }

  /**
   * Picks which of this person's photos their avatar is cropped from.
   *
   * Rejects an asset the person does not actually appear in — otherwise the
   * crop would be taken from a box that was never detected there, and the avatar
   * would show whatever happens to sit at those coordinates.
   */
  async setCover(userId: string, personId: string, assetId: string) {
    await this.get(userId, personId);

    const face = await this.prisma.assetFace.findFirst({
      where: { personId, assetId, deletedAt: null },
      select: { id: true },
    });
    if (!face) {
      throw new BadRequestException('That media item is not part of this group');
    }

    await this.prisma.person.update({
      where: { id: personId },
      data: { faceAssetId: assetId, thumbnailIsCustom: true },
    });

    // Remove the old crop so the new one is not served from cache.
    const person = await this.prisma.person.findUniqueOrThrow({
      where: { id: personId },
      select: { thumbnailPath: true },
    });
    await this.storage.removeMany([person.thumbnailPath || null]);
    await this.prisma.person.update({ where: { id: personId }, data: { thumbnailPath: '' } });

    const path = await this.generateThumbnail(personId);
    return { updated: Boolean(path) };
  }

  // -- thumbnails -----------------------------------------------------------

  /**
   * Crops a face out of the asset preview to use as the person's avatar.
   *
   * The box is padded outwards: a tight detection box cuts off hair and chin and
   * makes people hard to recognise at 48px.
   */
  async generateThumbnail(personId: string) {
    const chosen = await this.prisma.person.findUnique({
      where: { id: personId },
      select: { faceAssetId: true, thumbnailIsCustom: true },
    });

    const usable = {
      personId,
      deletedAt: null,
      asset: { deletedAt: null, previewPath: { not: null } },
    };

    /**
     * A cover picked by hand wins, and `faceAssetId` is where that choice lives —
     * so regenerating the avatar later does not quietly undo it. Falling back
     * when that photo has since been deleted matters: an avatar that silently
     * disappears is worse than one that reverts to the automatic pick.
     */
    const face =
      (chosen?.thumbnailIsCustom && chosen.faceAssetId
        ? await this.prisma.assetFace.findFirst({
            where: { ...usable, assetId: chosen.faceAssetId },
            include: { asset: true, person: true },
            orderBy: [{ score: 'desc' }],
          })
        : null) ??
      (await this.prisma.assetFace.findFirst({
        where: usable,
        include: { asset: true, person: true },
        // An automatic cover follows the newest recognised photo. This makes
        // a successful upload visible on the People & Pets page instead of
        // leaving an old avatar that makes the scan look unchanged.
        orderBy: [{ asset: { createdAt: 'desc' } }, { score: 'desc' }],
      }));

    if (!face?.asset.previewPath || !face.person) return null;

    let source = face.asset.previewPath;
    let temporary: string | null = null;

    if (face.asset.type === AssetType.VIDEO && face.sourceTimecodeMs !== null) {
      const video = face.asset.encodedVideoPath ?? face.asset.originalPath;
      temporary = this.storage.buildIncomingPath(
        face.person.ownerId,
        `${face.assetId}-${personId}-avatar-frame.jpg`,
      );
      await this.storage.remove(temporary);
      source = await this.media.extractPosterFrame(
        video,
        temporary,
        face.sourceTimecodeMs / 1000,
      );
    }

    if (!(await this.storage.exists(source))) {
      if (temporary) await this.storage.remove(temporary);
      return null;
    }

    const destination = this.storage.buildPersonThumbnailPath(face.person.ownerId, personId);
    await this.storage.ensureDir(dirname(destination));

    try {
      const metadata = await sharp(source).metadata();
      const previewWidth = metadata.width ?? face.imageWidth;
      const previewHeight = metadata.height ?? face.imageHeight;

      // Boxes were detected against a possibly different-sized image.
      const scaleX = previewWidth / (face.imageWidth || previewWidth);
      const scaleY = previewHeight / (face.imageHeight || previewHeight);

      const x1 = face.boundingBoxX1 * scaleX;
      const y1 = face.boundingBoxY1 * scaleY;
      const width = (face.boundingBoxX2 - face.boundingBoxX1) * scaleX;
      const height = (face.boundingBoxY2 - face.boundingBoxY1) * scaleY;

      const padding = Math.max(width, height) * 0.4;
      const left = Math.max(0, Math.round(x1 - padding));
      const top = Math.max(0, Math.round(y1 - padding));
      const cropWidth = Math.min(previewWidth - left, Math.round(width + padding * 2));
      const cropHeight = Math.min(previewHeight - top, Math.round(height + padding * 2));

      if (cropWidth <= 0 || cropHeight <= 0) return null;

      await sharp(source)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .resize(250, 250, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toFile(destination);

      await this.prisma.person.update({
        where: { id: personId },
        data: { thumbnailPath: destination, faceAssetId: face.assetId },
      });

      return destination;
    } catch (error) {
      this.logger.warn(`Could not build a thumbnail for person ${personId}: ${(error as Error).message}`);
      return null;
    } finally {
      if (temporary) await this.storage.remove(temporary);
    }
  }

  /** Replaces an automatic cover while leaving a user-picked one protected. */
  async refreshThumbnail(personId: string) {
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      select: { thumbnailPath: true, thumbnailIsCustom: true },
    });
    if (!person || person.thumbnailIsCustom) return person?.thumbnailPath ?? null;

    await this.storage.removeMany([person.thumbnailPath || null]);
    await this.prisma.person.update({
      where: { id: personId },
      data: { thumbnailPath: '' },
    });
    return this.generateThumbnail(personId);
  }

  /**
   * Rebuild covers for groups touched by a visibility change.
   *
   * A group may survive after its old cover is trashed because another active
   * photo still belongs to it. Without this refresh the People & Pets card
   * keeps showing the deleted photo, which looks exactly like recognition
   * attached the new photo to the wrong animal.
   */
  async refreshThumbnailsForAssets(assetIds: string[]) {
    if (assetIds.length === 0) return;

    const subjects = await this.prisma.person.findMany({
      where: {
        OR: [
          { faceAssetId: { in: assetIds } },
          { faces: { some: { assetId: { in: assetIds }, deletedAt: null } } },
        ],
      },
      select: { id: true, thumbnailPath: true },
    });

    for (const subject of subjects) {
      await this.refreshThumbnail(subject.id);
    }
  }

  async statistics(userId: string) {
    const [subjects, named, detections, unassigned] = await Promise.all([
      this.prisma.person.count({ where: { ownerId: userId } }),
      this.prisma.person.count({ where: { ownerId: userId, name: { not: '' } } }),
      this.prisma.assetFace.count({ where: { asset: { ownerId: userId }, deletedAt: null } }),
      this.prisma.assetFace.count({
        where: { asset: { ownerId: userId }, personId: null, deletedAt: null },
      }),
    ]);

    return { subjects, named, detections, unassigned };
  }
}
