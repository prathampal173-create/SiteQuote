import { groupProjectPhotos } from '../photoGroups';
import type { SavedPhoto } from '../photosApi';
const base: SavedPhoto = { id: 'f0', user_id: 'u', project_id: 'p', task_id: null,
  storage_path: 'u/p/f0.jpg', source: 'site_visit', state: 'active',
  created_at: 'now', updated_at: 'now' };
test('separates direct project photos and task photos without mixing sibling tasks', () => {
  const groups = groupProjectPhotos([
    base, { ...base, id: 'f1', task_id: 't1' }, { ...base, id: 'f2', task_id: 't2' }
  ], [{ id: 't1', title: 'Roof' }, { id: 't2', title: 'Walls' }]);
  expect(groups.map(({ title }) => title)).toEqual(['Direct project photos', 'Task: Roof', 'Task: Walls']);
  expect(groups.map(({ photos }) => photos.map(({ id }) => id))).toEqual([['f0'], ['f1'], ['f2']]);
});
