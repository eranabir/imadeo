/** Stable full-screen media geometry shared by both mobile viewers. */
export const VIEWER_HEADER_HEIGHT = 38;
export const VIEWER_MEDIA_TOP_GAP = 10;
export const VIEWER_ACTION_DOCK_HEIGHT = 38;
export const VIEWER_FILMSTRIP_HEIGHT = 38;
export const VIEWER_FILMSTRIP_GAP = 8;
/** Keep the three bottom rows on one rhythm: controls → filmstrip → actions. */
export const VIEWER_CONTROLS_GAP = VIEWER_FILMSTRIP_GAP;

export function clampViewerSafeBottom(safeBottom: number, isIOS: boolean) {
  const inset = Math.max(0, safeBottom);
  return isIOS ? Math.min(inset, 34) : inset;
}

export const viewerDockHeight = (safeBottom: number) =>
  safeBottom + VIEWER_ACTION_DOCK_HEIGHT;

export const viewerFilmstripBottom = (safeBottom: number) =>
  viewerDockHeight(safeBottom) + VIEWER_FILMSTRIP_GAP;

export const viewerVideoControlsBottom = (safeBottom: number) =>
  viewerFilmstripBottom(safeBottom) + VIEWER_FILMSTRIP_HEIGHT + VIEWER_CONTROLS_GAP;

export const viewerMediaBottom = (screenHeight: number, safeBottom: number) =>
  screenHeight - viewerDockHeight(safeBottom);

/**
 * Apple Photos centres media between the status-bar safe area and the bottom
 * action dock. Header controls and the filmstrip float over that stable stage.
 * Tall media can continue behind the controls without drawing under the notch,
 * while shorter media keeps balanced black space above and below.
 */
export function viewerMediaViewport(
  screenHeight: number,
  safeTop: number,
  safeBottom: number,
) {
  const top = Math.max(0, safeTop + VIEWER_MEDIA_TOP_GAP);
  const height = Math.max(1, viewerMediaBottom(screenHeight, safeBottom) - top);
  return { top, height, bottom: top + height };
}

/** The rectangle produced by `contentFit="contain"`, used by layout QA. */
export function containedMediaSize(
  viewportWidth: number,
  viewportHeight: number,
  mediaWidth: number,
  mediaHeight: number,
) {
  if (viewportWidth <= 0 || viewportHeight <= 0 || mediaWidth <= 0 || mediaHeight <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(viewportWidth / mediaWidth, viewportHeight / mediaHeight);
  return { width: mediaWidth * scale, height: mediaHeight * scale };
}
