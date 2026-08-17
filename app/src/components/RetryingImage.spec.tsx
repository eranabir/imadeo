import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RetryingImage } from './RetryingImage';
import { ThumbnailReadinessProvider } from './ThumbnailReadiness';

describe('RetryingImage', () => {
  it('renders a valid quiet placeholder instead of visible broken-image text while processing', () => {
    const markup = renderToStaticMarkup(
      <ThumbnailReadinessProvider>
        <RetryingImage
          src="/api/assets/asset-id/thumbnail"
          assetId="asset-id"
          thumbnailReady={false}
          alt="private-file-name.jpg"
        />
      </ThumbnailReadinessProvider>,
    );

    expect(markup).toContain('src="data:image/svg+xml,');
    expect(markup).toContain('alt=""');
    expect(markup).toContain('data-thumbnail-state="processing"');
    expect(markup).toContain('thumbnail-placeholder');
  });
});
