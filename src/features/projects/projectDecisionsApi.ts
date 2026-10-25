import { projectRequest, ProjectFailure, projectFailureMessage } from './projectsApi';
import type { Project } from './projectModel';

/** Only the two Phase 1D transitions enabled by the current database contract.
 * SQL RPCs lock the project, re-check ownership and state, and append history.
 */
async function runDecision(accountId: string, projectId: string, action: 'mark_project_lost' | 'reopen_project'):
  Promise<Project> {
  if (!projectId) throw new ProjectFailure('invalid');
  return projectRequest(accountId, async (client) => {
    const { data, error } = await client.rpc(action, { p_project_id: projectId });
    if (error) {
      if (error.code === '23514') throw new ProjectFailure('invalid');
      if (error.code === '42501') throw new ProjectFailure('not_found');
      throw error;
    }
    if (!data || data.id !== projectId || data.user_id !== accountId) throw new ProjectFailure('request');
    return data;
  });
}

export const markProjectLost = (accountId: string, projectId: string): Promise<Project> =>
  runDecision(accountId, projectId, 'mark_project_lost');

export const reopenProject = (accountId: string, projectId: string): Promise<Project> =>
  runDecision(accountId, projectId, 'reopen_project');

/** A Sent quote ID is required; server RPC validates exact owner, project, status, and locks. */
export const markProjectWon = (accountId: string, projectId: string, quoteId: string): Promise<Project> => {
  if (!quoteId) return Promise.reject(new ProjectFailure('invalid'));
  return projectRequest(accountId, async (client) => {
    const { data, error } = await client.rpc('mark_project_won', {
      p_project_id: projectId, p_quote_id: quoteId
    });
    if (error) {
      if (error.code === '23514') throw new ProjectFailure('invalid');
      if (error.code === '42501') throw new ProjectFailure('not_found');
      throw error;
    }
    if (!data || data.id !== projectId || data.user_id !== accountId ||
      data.status !== 'won' || data.accepted_quote_id !== quoteId) throw new ProjectFailure('request');
    return data;
  });
};

/** A stale/invalid transition is not a project-form validation error. */
export function decisionFailureMessage(error: unknown): string {
  if (error instanceof ProjectFailure) {
    if (error.reason === 'invalid') return 'Project status changed or the action is no longer allowed. Refresh and retry.';
    if (error.reason === 'not_found') return 'Project unavailable or permission denied. Refresh and retry.';
    if (error.reason === 'request') return 'Could not save the decision. Check your connection and retry.';
  }
  return projectFailureMessage(error);
}
