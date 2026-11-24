import { useAuthStore } from '../../stores/useAuthStore';
import { useApiHubModel } from './useApiHubModel';
import { ApiHubView } from './ApiHubView';

export default function ApiHub() {
 const workspaceId = useAuthStore(s => s.currentWorkspaceId);
 const uid = useAuthStore(s => s.user?.uid);
 return <ScopedApiHub key={JSON.stringify([uid, workspaceId])} />;
}

function ScopedApiHub() {
 return <ApiHubView {...useApiHubModel()} />;
}
