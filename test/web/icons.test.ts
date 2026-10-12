import { describe, expect, it } from 'vitest';
import { icon } from '../../src/web/icons.ts';

const render = async (markup: unknown) => String(await markup);

describe('icon', () => {
  it('renders a Phosphor icon inline, decorative and sized', async () => {
    const svg = await render(icon('house'));
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('viewBox="0 0 256 256"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
    expect(svg).toContain('class="size-5 shrink-0"');
    expect(svg).toContain('<path d="M219.31,108.68');
  });

  it('takes a weight and a size class', async () => {
    const svg = await render(icon('house', { weight: 'duotone', size: 'size-6' }));
    expect(svg).toContain('opacity="0.2"');
    expect(svg).toContain('class="size-6 shrink-0"');
  });

  it('carries its size as width and height too, so it stays small without JavaScript (Tailwind runs in the browser)', async () => {
    expect(await render(icon('house'))).toContain('width="20" height="20"');
    expect(await render(icon('house', { size: 'size-6' }))).toContain('width="24" height="24"');
    expect(await render(icon('house', { size: 'size-3.5' }))).toContain('width="14" height="14"');
    expect(await render(icon('house', { size: 'size-[18px]' }))).toContain('width="18" height="18"');
  });

  it('refuses a name Phosphor does not have, so a typo fails the render', () => {
    expect(() => icon('no-such-icon')).toThrow(/Phosphor icon "no-such-icon"/);
    expect(() => icon('../../package')).toThrow(/Phosphor icon/);
  });
});
