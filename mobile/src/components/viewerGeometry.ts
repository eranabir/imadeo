/** Stable full-screen media geometry shared by both mobile viewers. */
export const VIEWER_HEADER_HEIGHT = 52;
export const VIEWER_MEDIA_TOP_GAP = 12;
export const VIEWER_ACTION_DOCK_HEIGHT = 48;
export const VIEWER_FILMSTRIP_HEIGHT = 48;
export const VIEWER_FILMSTRIP_GAP = 8;
export const VIEWER_PANEL_TOP_PADDING = VIEWER_MEDIA_TOP_GAP;
/** Keep the three bottom rows on one rhythm: controls → filmstrip → actions. */
export const VIEWER_CONTROLS_GAP = VIEWER_FILMSTRIP_GAP;
export const VIEWER_VIDEO_CONTROLS_HEIGHT = 48;
/** Icons remain above the home indicator; don't reserve the tab bar's inset. */
export const VIEWER_IOS_BOTTOM_CLEARANCE = 12;

/** Match the lower chrome edge on inset-free displays, while clearing status UI. */
export const viewerHeaderTop = (safeTop: number) =>
  Math.max(VIEWER_IOS_BOTTOM_CLEARANCE, safeTop);

export function clampViewerSafeBottom(safeBottom: number, isIOS: boolean) {
  const inset = Math.max(0, safeBottom);
  return isIOS ? Math.min(inset, VIEWER_IOS_BOTTOM_CLEARANCE) : inset;
}

export const viewerDockHeight = (safeBottom: number) =>
  safeBottom + VIEWER_ACTION_DOCK_HEIGHT;

export const viewerFilmstripBottom = (safeBottom: number) =>
  viewerDockHeight(safeBottom) + VIEWER_FILMSTRIP_GAP;

export const viewerVideoControlsBottom = (safeBottom: number) =>
  viewerFilmstripBottom(safeBottom) + VIEWER_FILMSTRIP_HEIGHT + VIEWER_CONTROLS_GAP;

export const viewerBottomPanelHeight = (safeBottom: number, video = false) =>
  viewerFilmstripBottom(safeBottom) + VIEWER_FILMSTRIP_HEIGHT + VIEWER_PANEL_TOP_PADDING
  + (video ? VIEWER_VIDEO_CONTROLS_HEIGHT + VIEWER_CONTROLS_GAP : 0);

export const viewerMediaBottom = (screenHeight: number, safeBottom: number, video = false) =>
  screenHeight - viewerBottomPanelHeight(safeBottom, video);

/** Photos fill the screen beneath floating chrome; videos keep playback clearance. */
export function viewerMediaViewport(
  screenHeight: number,
  safeTop: number,
  safeBottom: number,
  video = false,
) {
  if (!video) return { top: 0, height: Math.max(1, screenHeight), bottom: screenHeight };
  const top = viewerHeaderTop(safeTop) + VIEWER_HEADER_HEIGHT + VIEWER_MEDIA_TOP_GAP;
  const height = Math.max(1, viewerMediaBottom(screenHeight, safeBottom, video) - top);
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

/** Align all viewer controls while keeping them comfortable on wide displays. */
export function viewerChromeFrame(screenWidth: number, safeLeft = 0, safeRight = 0) {
  const safeWidth = Math.max(1, screenWidth - safeLeft - safeRight);
  const width = Math.max(1, Math.min(560, safeWidth - 32));
  return { left: safeLeft + (safeWidth - width) / 2, width };
}
