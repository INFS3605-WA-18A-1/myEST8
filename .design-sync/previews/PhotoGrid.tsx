import { PhotoGrid } from 'myest8-design-system';

const photo = (fill: string, label: string) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${fill}"/><text x="60" y="66" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#323233">${label}</text></svg>`,
  );

export const TenantPhotos = () => (
  <div style={{ maxWidth: 640 }}>
    <PhotoGrid
      items={[
        { src: photo('#dedcd4', 'Laundry floor'), caption: 'Water under the unit' },
        { src: photo('#e8f1ea', 'Base of tank'), caption: 'Drip from the valve' },
        { src: photo('#fdf1e3', 'Compliance plate') },
        { src: photo('#f1f0ea', 'Power point'), caption: 'Near the leak' },
      ]}
    />
  </div>
);
