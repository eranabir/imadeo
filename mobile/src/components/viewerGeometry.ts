/** Stable full-screen media geometry shared by both mobile viewers. */
export const VIEWER_HEADER_HEIGHT = 52;
export const VIEWER_MEDIA_TOP_GAP = 12;
export const VIEWER_ACTION_DOCK_HEIGHT = 48;
export const VIEWER_FILMSTRIP_HEIGHT = 48;
export const VIEWER_FILMSTRIP_GAP = 8;
export const VIEWER_PANEL_TOP_PADDING = VIEWER_MEDIA_TOP_GAP;
/** Playback sits immediately above the filmstrip; actions live in the side rail. */
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
  safeBottom + VIEWER_IOS_BOTTOM_CLEARANCE;

export const viewerVideoControlsBottom = (safeBottom: number) =>
  viewerFilmstripBottom(safeBottom) + VIEWER_FILMSTRIP_HEIGHT + VIEWER_CONTROLS_GAP;

export const viewerBottomPanelHeight = (safeBottom: number, video = false) =>
  viewerFilmstripBottom(safeBottom) + VIEWER_FILMSTRIP_HEIGHT + VIEWER_PANEL_TOP_PADDING
  + (video ? VIEWER_VIDEO_CONTROLS_HEIGHT + VIEWER_CONTROLS_GAP : 0);

export const viewerMediaBottom = (screenHeight: number, safeBottom: number, video = false) =>
  screenHeight - viewerBottomPanelHeight(safeBottom, video);

/** Photos and videos fill the same stable frame beneath floating controls. */
export function viewerMediaViewport(
  screenHeight: number,
  _safeTop: number,
  _safeBottom: number,
  _video = false,
) {
  return { top: 0, height: Math.max(1, screenHeight), bottom: screenHeight };
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


/** Center controls inside Duo's system rail; use a trailing inset elsewhere. */
export function viewerRailFrame(
  screenWidth: number, screenHeight: number,
  insets: { top: number; left: number; right: number }, safeBottom: number,
) {
  const width = VIEWER_ACTION_DOCK_HEIGHT;
  // Align with the native status column, slightly inward of the inset midpoint.
  const right = insets.right >= 72 ? (insets.right - width) / 2 + 4 : insets.right + 16;
  // The Duo status cluster occupies the top of its system rail.
  const top = Math.max(viewerHeaderTop(insets.top) + VIEWER_HEADER_HEIGHT + 12,
    insets.right >= 72 ? 176 : 88);
  return { right, top, width, height: Math.max(width, screenHeight - top - safeBottom - 12) };
}
