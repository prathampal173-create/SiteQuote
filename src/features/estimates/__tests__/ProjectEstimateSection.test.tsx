import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProjectEstimateSection } from '../ProjectEstimateSection';
import { addAdditionalCharge, editAdditionalCharge, loadWorkingEstimate,
  removeAdditionalCharge, saveTaxRate } from '../estimatesApi';

jest.mock('expo-router', () => ({ useFocusEffect: (cb: () => () => void) => require('react').useEffect(cb, [cb]) }));
jest.mock('../estimatesApi', () => ({
  loadWorkingEstimate: jest.fn(), addAdditionalCharge: jest.fn(), editAdditionalCharge: jest.fn(),
  removeAdditionalCharge: jest.fn(), saveTaxRate: jest.fn(),
  estimateFailureMessage: () => 'Could not save estimate.'
}));
const openEstimate = {
  status: 'draft', tasks: [{ id: 't', title: 'Kitchen', amount_minor: 300000 }],
  charges: [{ id: 'c', description: 'Permit', amount_minor: 15000 }],
  totals: { taskSubtotalMinor: 300000, chargesTotalMinor: 15000, pretaxMinor: 315000,
    taxMinor: 25200, finalMinor: 340200, taxBps: 800 }
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadWorkingEstimate).mockResolvedValue(openEstimate as never);
  jest.mocked(addAdditionalCharge).mockResolvedValue(undefined);
  jest.mocked(editAdditionalCharge).mockResolvedValue(undefined);
  jest.mocked(removeAdditionalCharge).mockResolvedValue(undefined);
  jest.mocked(saveTaxRate).mockResolvedValue(undefined);
});
function mount(closed = false) {
  return render(<ProjectEstimateSection accountId="a" accountScope={1} projectId="p" closed={closed} />);
}
test('renders itemized $3,402 working estimate and tax amount', async () => {
  mount();
  await waitFor(() => expect(screen.getByText('$3,402.00')).toBeTruthy());
  expect(screen.getAllByText('$3,000.00').length).toBeGreaterThan(0);
  expect(screen.getAllByText('$150.00').length).toBeGreaterThan(0);
  expect(screen.getByText('$252.00')).toBeTruthy();
  expect(screen.getByText('Working estimate (USD)')).toBeTruthy();
});
test('add charge validates input and saves exact decimal string to owner/project', async () => {
  mount();
  await waitFor(() => expect(screen.getByText('$3,402.00')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('Charge amount (USD)'), '0.00');
  fireEvent.press(screen.getByText('Add Charge'));
  expect(screen.getByText('Charge description is required.')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Charge description'), 'Waste removal');
  fireEvent.changeText(screen.getByLabelText('Charge amount (USD)'), '12.34');
  fireEvent.press(screen.getByText('Add Charge'));
  await waitFor(() => expect(addAdditionalCharge).toHaveBeenCalledWith('a', 'p', 'Waste removal', '12.34'));
  expect(loadWorkingEstimate).toHaveBeenCalledWith('a', 'p');
});
test('editing and confirmed removal are project scoped', async () => {
  mount();
  await waitFor(() => expect(screen.getByText('$3,402.00')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Edit charge Permit'));
  expect(screen.getByDisplayValue('150.00')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Charge amount (USD)'), '151.01');
  fireEvent.press(screen.getByText('Save Charge'));
  await waitFor(() => expect(editAdditionalCharge).toHaveBeenCalledWith('a', 'p', 'c', 'Permit', '151.01'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  fireEvent.press(screen.getByLabelText('Remove charge Permit'));
  const options = alert.mock.calls[0]![2]! as { text: string; onPress?: () => void }[];
  expect(removeAdditionalCharge).not.toHaveBeenCalled();
  await act(async () => { options.find((a) => a.text === 'Remove')?.onPress?.(); });
  await waitFor(() => expect(removeAdditionalCharge).toHaveBeenCalledWith('a', 'p', 'c'));
  alert.mockRestore();
});
test('tax update is project-specific and blocks invalid values', async () => {
  mount();
  await waitFor(() => expect(screen.getByText('$3,402.00')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('Project tax rate (%)'), '30.01');
  expect(screen.getByLabelText('Save Tax Rate').props.accessibilityState.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText('Project tax rate (%)'), '8.25');
  fireEvent.press(screen.getByText('Save Tax Rate'));
  await waitFor(() => expect(saveTaxRate).toHaveBeenCalledWith('a', 'p', '8.25'));
});
test('Won/Lost project exposes totals but no price mutation controls', async () => {
  mount(true);
  await waitFor(() => expect(screen.getByText('$3,402.00')).toBeTruthy());
  expect(screen.getByText('Won/Lost pricing is read-only until Reopen.')).toBeTruthy();
  expect(screen.queryByLabelText('Charge description')).toBeNull();
  expect(screen.queryByLabelText('Save Tax Rate')).toBeNull();
  expect(screen.queryByLabelText('Remove charge Permit')).toBeNull();
});
