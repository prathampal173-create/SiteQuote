import type { Task } from '../tasks/taskModel';
import type { SavedPhoto } from './photosApi';

export type PhotoGroup = { key: string; title: string; photos: SavedPhoto[] };

/** Direct project photos never appear in a task group; task galleries are exact-ID only. */
export function groupProjectPhotos(photos: SavedPhoto[], tasks: Pick<Task, 'id' | 'title'>[]): PhotoGroup[] {
  const direct = photos.filter((photo) => photo.task_id === null);
  const result: PhotoGroup[] = [{ key: 'direct', title: 'Direct project photos', photos: direct }];
  for (const task of tasks) {
    const items = photos.filter((photo) => photo.task_id === task.id);
    result.push({ key: task.id, title: `Task: ${task.title}`, photos: items });
  }
  return result;
}
