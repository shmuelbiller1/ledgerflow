import { auth } from "../firebase";
import { reportError, OperationType as GlobalOperationType } from "./utils";
import { markReported } from './inBackground';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

/**
 * Specialized Firestore Error Handler
 * Enriches errors with auth context before reporting to global forensic logger
 */
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const authInfo = {
    userId: auth.currentUser?.uid,
    email: auth.currentUser?.email,
    emailVerified: auth.currentUser?.emailVerified,
    isAnonymous: auth.currentUser?.isAnonymous,
    tenantId: auth.currentUser?.tenantId,
    providerInfo: auth.currentUser?.providerData.map(provider => ({
      providerId: provider.providerId,
      displayName: provider.displayName,
      email: provider.email,
      photoUrl: provider.photoURL
    })) || []
  };

  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo,
    operationType,
    path
  };

  // Delegate to global reporter with enriched context
  reportError(error, operationType as unknown as GlobalOperationType, path, { auth: authInfo });
  
  // Re-throw to trigger boundary if needed, but the reporter already notified the UI via toast
  throw markReported(new Error(JSON.stringify(errInfo)));
}
