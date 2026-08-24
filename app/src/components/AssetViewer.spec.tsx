import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgressiveOriginalImage } from './AssetViewer';

describe('ProgressiveOriginalImage', () => {
  it('shows a quick preview while loading the untouched original', () => {
    const markup = renderToStaticMarkup(
      <ProgressiveOriginalImage
        assetId="asset-id"
        alt="family-photo.jpg"
        style={{ objectFit: 'contain' }}
      />,
    );

    expect(markup).toContain('/api/assets/asset-id/thumbnail?size=preview');
    expect(markup).toContain('/api/assets/asset-id/original');
    expect(markup).toContain('alt="family-photo.jpg"');
  });
});
