import { render, screen } from '@testing-library/react-native';
import TabLayout from '../../../../app/(tabs)/_layout';
import { useAuthFlow } from '../AuthFlowProvider';

jest.mock('../AuthFlowProvider', () => ({ useAuthFlow: jest.fn() }));
jest.mock('expo-router', () => {
  const { Text, View } = require('react-native');
  const Tabs = Object.assign(
    ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    { Screen: ({ name }: { name: string }) => <Text>{name}</Text> }
  );
  const Redirect = ({ href }: { href: string }) => <Text>Denied: {href}</Text>;
  return { Tabs, Redirect };
});

const flowMock = jest.mocked(useAuthFlow);

test('direct tab access without OTP-approved session redirects to Welcome even in development', () => {
  flowMock.mockReturnValue({ authorized: false } as ReturnType<typeof useAuthFlow>);
  render(<TabLayout />);
  expect(screen.getByText('Denied: /')).toBeTruthy();
  expect(screen.queryByText('Dashboard')).toBeNull();
});

test('four tabs are mounted only after verified grant', () => {
  flowMock.mockReturnValue({ authorized: true } as ReturnType<typeof useAuthFlow>);
  render(<TabLayout />);
  for (const name of ['index', 'leads', 'reminders', 'settings']) {
    expect(screen.getByText(name)).toBeTruthy();
  }
});
