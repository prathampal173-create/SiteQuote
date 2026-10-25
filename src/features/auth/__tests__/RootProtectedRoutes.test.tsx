// Route guard tests isolate lifecycle coordinators; their behavior has separate suites.
jest.mock('../../notifications/NotificationTapCoordinator', () => ({ NotificationTapCoordinator: () => null }));
jest.mock('../../notifications/NotificationLifecycleCoordinator', () => ({ NotificationLifecycleCoordinator: () => null }));
import { fireEvent, render, screen } from '@testing-library/react-native';
import RootLayout from '../../../../app/_layout';
import { useAuthFlow } from '../AuthFlowProvider';

jest.mock('../AuthFlowProvider', () => ({
  AuthFlowProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuthFlow: jest.fn()
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children
}));
jest.mock('expo-router', () => {
  const { Text, View } = require('react-native');
  const Stack = Object.assign(
    ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    {
      Screen: ({ name }: { name: string }) => <Text>{name}</Text>,
      Protected: ({ guard, children }: { guard: boolean; children: React.ReactNode }) =>
        guard ? <View>{children}</View> : <Text>Protected tabs blocked</Text>
    }
  );
  return { Stack };
});
const flowMock = jest.mocked(useAuthFlow);

test('root guard prevents direct and deep-link tab routes before OTP approval', () => {
  flowMock.mockReturnValue({ authorized: false } as ReturnType<typeof useAuthFlow>);
  render(<RootLayout />);
  expect(screen.getByText('Protected tabs blocked')).toBeTruthy();
  expect(screen.queryByText('(tabs)')).toBeNull();
});

test('root guard includes the tabs group only after verified in-memory access', () => {
  flowMock.mockReturnValue({ authorized: true } as ReturnType<typeof useAuthFlow>);
  render(<RootLayout />);
  expect(screen.getByText('(tabs)')).toBeTruthy();
});

test('failed restoration offers credential cleanup without opening protected routes', () => {
  const signOut = jest.fn().mockResolvedValue(true);
  flowMock.mockReturnValue({ authorized: false, checking: false,
    sessionError: 'Unable to verify your saved session.', retryRestore: jest.fn(), signOut
  } as unknown as ReturnType<typeof useAuthFlow>);
  render(<RootLayout />);
  expect(screen.queryByText('(tabs)')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Clear saved session' }));
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('(tabs)')).toBeNull();
});
