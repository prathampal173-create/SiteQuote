import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProjectFormScreen } from '../ProjectFormScreen';
import { ProjectDetailScreen } from '../ProjectDetailScreen';
import { ProjectsScreen } from '../ProjectsScreen';
import { LeadProjectsSection } from '../LeadProjectsSection';
import { ProjectCard } from '../ProjectCard';
import { createProject, listLeadProjects, listProjects, loadProject, updateProject } from '../projectsApi';
import type { Project, ProjectWithLead } from '../projectModel';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockAccount = { accountId: 'a', accountScope: 1 };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => mockRouter,
  useFocusEffect: (cb: () => () => void) => require('react').useEffect(cb, [cb])
}));
jest.mock('../../auth/AuthFlowProvider', () => ({ useAuthFlow: () => mockAccount }));
jest.mock('../../photos/PhotoStagingSection', () => ({ PhotoStagingSection: () => null }));
jest.mock('../../photos/PhotoGallerySection', () => ({ PhotoGallerySection: () => null }));

jest.mock('../../tasks/ProjectTasksSection', () => ({ ProjectTasksSection: () => null }));
jest.mock('../../estimates/ProjectEstimateSection', () => ({ ProjectEstimateSection: () => null }));
jest.mock('../../estimates/UnsentEstimateSection', () => ({ UnsentEstimateSection: () => null }));
jest.mock('../ProjectDecisionControls', () => ({ ProjectDecisionControls: () => null }));
jest.mock('../projectQuoteSummary', () => ({
  loadProjectQuoteSummaries: jest.fn(async (_id: string, rows: { id: string }[]) => new Map(rows.map((p) => [p.id, null]))),
  quoteSummaryLine: () => 'No sent quote'
}));
jest.mock('../projectsApi', () => ({ createProject: jest.fn(), updateProject: jest.fn(),
  loadProject: jest.fn(), listProjects: jest.fn(), listLeadProjects: jest.fn(),
  projectFailureMessage: () => 'Network unavailable. Retry.' }));
const kitchen: Project = { id: 'p1', user_id: 'a', lead_id: 'l1', title: 'Kitchen Renovation',
  site_address: '11 Main', notes: 'Kitchen notes', status: 'draft', accepted_quote_id: null,
  tax_bps: 0, created_at: '2026-10-22', updated_at: '2026-10-22' };
const bathroom: Project = { ...kitchen, id: 'p2', title: 'Bathroom Upgrade',
  site_address: null, notes: 'Bathroom notes', status: 'won' };
const mockCreate = jest.mocked(createProject);
const mockUpdate = jest.mocked(updateProject);
const mockLoad = jest.mocked(loadProject);
const mockList = jest.mocked(listProjects);
const mockLeadProjects = jest.mocked(listLeadProjects);

beforeEach(() => {
  mockAccount = { accountId: 'a', accountScope: 1 };
  Object.values(mockRouter).forEach((fn) => fn.mockReset());
  mockCreate.mockReset(); mockUpdate.mockReset(); mockLoad.mockReset(); mockList.mockReset(); mockLeadProjects.mockReset();
  mockCreate.mockResolvedValue(kitchen); mockUpdate.mockResolvedValue(kitchen);
  mockLoad.mockResolvedValue(kitchen); mockList.mockResolvedValue([]); mockLeadProjects.mockResolvedValue([]);
});

test('project create form checks required name and sends owning lead', async () => {
  render(<ProjectFormScreen leadId="l1" />);
  fireEvent.press(screen.getByText('Save Project'));
  expect(screen.getByText('Project name is required.')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Project name'), 'Kitchen Renovation');
  fireEvent.changeText(screen.getByLabelText('Site address (optional)'), '11 Main');
  fireEvent.press(screen.getByText('Save Project'));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('a', 'l1', expect.objectContaining({
    title: 'Kitchen Renovation', siteAddress: '11 Main'
  })));
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/project/[id]', params: { id: 'p1', saved: '1' } });
});

test('edit form preserves loaded nullable and existing project-specific values', async () => {
  mockUpdate.mockResolvedValue({ ...bathroom, notes: 'Revised only bathroom' });
  mockLoad.mockResolvedValue(bathroom);
  render(<ProjectFormScreen id="p2" />);
  await waitFor(() => expect(screen.getByDisplayValue('Bathroom Upgrade')).toBeTruthy());
  expect(screen.getByDisplayValue('Bathroom notes')).toBeTruthy();
  expect(screen.getByLabelText('Project name').props.editable).toBe(false);
  fireEvent.changeText(screen.getByLabelText('Internal project notes (optional)'), 'Revised only bathroom');
  fireEvent.press(screen.getByText('Save Project'));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('a', 'p2', expect.objectContaining({
    notes: 'Revised only bathroom', title: 'Bathroom Upgrade'
  })));
});

test('form retains unsaved input after network failure and retry, blocks duplicate submission', async () => {
  let fail!: (e: Error) => void;
  mockCreate.mockImplementationOnce(() => new Promise<Project>((_, reject) => { fail = reject; }))
    .mockResolvedValueOnce(kitchen);
  render(<ProjectFormScreen leadId="l1" />);
  fireEvent.changeText(screen.getByLabelText('Project name'), 'Kitchen Renovation');
  fireEvent.press(screen.getByText('Save Project'));
  fireEvent.press(screen.getByText('Saving project…'));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  fail(new Error('offline'));
  await waitFor(() => expect(screen.getByText('Network unavailable. Retry.')).toBeTruthy());
  expect(screen.getByDisplayValue('Kitchen Renovation')).toBeTruthy();
  fireEvent.press(screen.getByText('Save Project'));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
});

test('multiple project cards keep independent ID, status and navigation', async () => {
  mockLeadProjects.mockResolvedValue([kitchen, bathroom]);
  render(<LeadProjectsSection accountId="a" accountScope={1} leadId="l1" />);
  await waitFor(() => expect(screen.getByText('Projects (2)')).toBeTruthy());
  expect(screen.getByText('Kitchen Renovation')).toBeTruthy();
  expect(screen.getByText('Bathroom Upgrade')).toBeTruthy();
  expect(screen.getByText('Status: Draft')).toBeTruthy();
  expect(screen.getByText('Status: Won')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Open project Bathroom Upgrade, Won'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/project/[id]', params: { id: 'p2' } });
  fireEvent.press(screen.getByText('Create Project'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/project/new', params: { leadId: 'l1' } });
});

test('zero projects, failure and retry are visible without inventing projects', async () => {
  mockLeadProjects.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
  render(<LeadProjectsSection accountId="a" accountScope={1} leadId="l1" />);
  await waitFor(() => expect(screen.getByText('Network unavailable. Retry.')).toBeTruthy());
  fireEvent.press(screen.getByText('Retry customer projects'));
  await waitFor(() => expect(screen.getByText('No projects for this customer yet.')).toBeTruthy());
});

test('project list filters use current row status and show matching lead names', async () => {
  const rows: ProjectWithLead[] = [
    { project: kitchen, leadName: 'Customer A' }, { project: bathroom, leadName: 'Customer A' },
    { project: { ...kitchen, id: 'p3', title: 'Painting', status: 'quote_sent' }, leadName: 'Customer B' },
    { project: { ...kitchen, id: 'p4', title: 'Floor', status: 'lost' }, leadName: 'Customer C' }
  ];
  mockList.mockResolvedValue(rows);
  render(<ProjectsScreen />);
  await waitFor(() => expect(screen.getByText('Painting')).toBeTruthy());
  for (const [status, title] of [['Draft', 'Kitchen Renovation'], ['Quote Sent', 'Painting'],
    ['Won', 'Bathroom Upgrade'], ['Lost', 'Floor']] as const) {
    fireEvent.press(screen.getByLabelText(`Project filter: ${status}`));
    expect(screen.getByText(title)).toBeTruthy();
    for (const other of rows.filter(({ project }) => project.title !== title)) {
      expect(screen.queryByText(other.project.title)).toBeNull();
    }
  }
});

test('detail displays persisted project status without enabling Quote Sent or decisions', async () => {
  mockLoad.mockResolvedValue({ ...kitchen, status: 'quote_sent' });
  render(<ProjectDetailScreen id="p1" />);
  await waitFor(() => expect(screen.getByText('Status: Quote Sent')).toBeTruthy());
  expect(screen.getByText('Site address: 11 Main')).toBeTruthy();
  expect(screen.queryByText('Mark Won')).toBeNull();
  expect(screen.queryByText('Mark Sent')).toBeNull();
  fireEvent.press(screen.getByText('Edit Project'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/project/edit/[id]', params: { id: 'p1' } });
});

test('account switching erases project list before stale A response resolves', async () => {
  let finishA!: (result: ProjectWithLead[]) => void;
  mockList.mockImplementationOnce(() => new Promise<ProjectWithLead[]>((resolve) => { finishA = resolve; }))
    .mockResolvedValueOnce([{ project: { ...bathroom, id: 'B-project', user_id: 'b' }, leadName: 'B Customer' }]);
  const ui = render(<ProjectsScreen />);
  await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
  mockAccount = { accountId: 'b', accountScope: 2 };
  ui.rerender(<ProjectsScreen />);
  await waitFor(() => expect(screen.getByText(/B Customer/)).toBeTruthy());
  finishA([{ project: kitchen, leadName: 'A Customer' }]);
  await waitFor(() => expect(screen.queryByText(/A Customer/)).toBeNull());
});

test('project card accessibility identifies correct status without quote amount', () => {
  render(<ProjectCard project={kitchen} onPress={() => {}} />);
  expect(screen.getByLabelText('Open project Kitchen Renovation, Draft')).toBeTruthy();
  expect(screen.queryByText('$0.00')).toBeNull();
});
