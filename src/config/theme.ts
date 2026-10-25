export const colors = {
  background: '#F5F7FB',
  surface: '#FFFFFF',
  primary: '#0B4499',
  primaryPressed: '#123F83',
  text: '#17191F',
  mutedText: '#687282',
  border: '#E0E4ED',
  inputBorder: '#687282',
  successText: '#18663D',
  successBackground: '#E1F4E9',
  warningText: '#86530B',
  warningBackground: '#FFF1D6',
  dangerText: '#A22A31',
  dangerBackground: '#FDE7E7'
} as const;

export const spacing = {
  xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32
} as const;

export const radius = { card: 12, input: 10, dialog: 16 } as const;

export const typography = {
  title: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  section: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  total: { fontSize: 22, lineHeight: 30, fontWeight: '700' }
} as const;

export const layout = {
  narrowWidth: 360,
  narrowGutter: 16,
  gutter: 20,
  minTouchTarget: 44,
  maxContentWidth: 600
} as const;
