import { colors, layout, radius, spacing, typography } from '../theme';

describe('design foundation', () => {
  it('matches the documented primary colors and spacing', () => {
    expect(colors.background).toBe('#F5F7FB');
    expect(colors.primary).toBe('#0B4499');
    expect(colors.surface).toBe('#FFFFFF');
    expect(spacing).toEqual({ xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32 });
  });

  it('honors documented text sizes, radii and touch targets', () => {
    expect(typography.title).toMatchObject({ fontSize: 20, lineHeight: 28 });
    expect(typography.body).toMatchObject({ fontSize: 15, lineHeight: 22 });
    expect(typography.total).toMatchObject({ fontSize: 22, lineHeight: 30 });
    expect(radius.card).toBe(12);
    expect(layout.minTouchTarget).toBeGreaterThanOrEqual(44);
  });
});
