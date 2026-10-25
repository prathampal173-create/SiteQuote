import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppButton } from '../AppButton';

describe('AppButton', () => {
  it('exposes its label and handles activation', () => {
    const onPress = jest.fn();
    render(<AppButton label="Sign Up" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Sign Up' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not activate when disabled', () => {
    const onPress = jest.fn();
    render(<AppButton label="Save" onPress={onPress} disabled />);
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});
