import type { UploadCandidate, UploadDestination } from './uploadHistory';

/** Builds the exact payload for both the first attempt and every retry. */
export function buildUploadForm(
  candidate: UploadCandidate,
  destination: UploadDestination,
  allowDuplicate = false,
) {
  const { file, relativePath, uploadId } = candidate;
  const form = new FormData();
  form.append('assetData', file);
  form.append('fileCreatedAt', new Date(file.lastModified).toISOString());
  form.append('fileModifiedAt', new Date(file.lastModified).toISOString());
  if (uploadId) form.append('uploadId', uploadId);
  if (relativePath) form.append('relativePath', relativePath);
  if (destination.folderId) form.append('folderId', destination.folderId);
  if (destination.albumId) form.append('albumId', destination.albumId);
  if (allowDuplicate) form.append('allowDuplicate', 'true');
  return form;
}
