/** EU-E9: the label export columns for the workspace open now (its labels and their values in the store). */
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { labelExportColumns } from './labelQueryFilter';

export const currentLabelColumns = () =>
  labelExportColumns(useAuthStore.getState().getCurrentWorkspace()?.dimensions || [], useLedgerStore.getState().dimensionNodes || []);
