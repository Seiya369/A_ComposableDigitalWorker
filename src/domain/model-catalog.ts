import type { ModelModule } from './types.js';

/** Safe projection of the host's configured model catalog; never contains credentials. */
export interface EmployeeModelOption {
  provider: string;
  providerName: string;
  model: string;
  modelName: string;
  reasoningEfforts?: Array<{ id: string; name: string }>;
  defaultReasoningEffort?: string;
}

export interface EmployeeModelSelection { provider: string; model: string; reasoningEffort?: string }
export interface EmployeeModelCatalog { models: EmployeeModelOption[]; default?: EmployeeModelSelection }

/** Default mode follows the host; an employee's explicit choice always wins. */
export function resolveEmployeeModelSelection(value: ModelModule, catalog: EmployeeModelCatalog): ModelModule {
  return value.mode === 'inherit' && catalog.default ? { mode: 'override', ...catalog.default } : value;
}
