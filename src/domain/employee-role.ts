import type { ModelModule, ResponsibilitiesModule } from './types.js';

/** A one-shot editor draft. It neither saves the employee nor creates a task. */
export interface EmployeeRoleDraftInput { name: string; model: ModelModule }
export interface EmployeeRoleDraftResult { responsibilities: ResponsibilitiesModule }
