import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgressiveOriginalImage } from './AssetViewer';
import { ThumbnailReadinessProvider } from './ThumbnailReadiness';

describe('ProgressiveOriginalImage', () => {
  it('shows a quick preview while loading the untouched original', () => {
    const markup = renderToStaticMarkup(
      <ThumbnailReadinessProvider>
        <ProgressiveOriginalImage
          assetId="asset-id"
          alt="family-photo.jpg"
          style={{ objectFit: 'contain' }}
        />
      </ThumbnailReadinessProvider>,
    );

    expect(markup).toContain('/api/assets/asset-id/thumbnail?size=preview');
    expect(markup).toContain('/api/assets/asset-id/original');
    expect(markup).toContain('alt="family-photo.jpg"');
  });

  it('keeps a HEIC viewer on the processing placeholder until its preview is ready', () => {
    const markup = renderToStaticMarkup(
      <ThumbnailReadinessProvider>
        <ProgressiveOriginalImage
          assetId="pending-heic"
          alt="new-photo.heic"
          thumbnailReady={false}
          style={{ objectFit: 'contain' }}
        />
      </ThumbnailReadinessProvider>,
    );

    expect(markup).toContain('data-thumbnail-state="processing"');
    expect(markup).toContain('src="data:image/svg+xml,');
    expect(markup).not.toContain('src="/api/assets/pending-heic/thumbnail?size=preview"');
  });
});
