/**
 * Firebase-Auth-compatible sign-in layer on Supabase Auth (browser).
 *
 * Keeps the calls the app already makes: onAuthStateChanged, signInWithEmailAndPassword,
 * createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut,
 * signInWithPopup(GoogleAuthProvider), multiFactor(user) + TotpMultiFactorGenerator, and a
 * `User` with uid / email / getIdToken() / getIdTokenResult().
 *
 * Admin status comes from app_metadata (only the server can set it), exposed as
 * claims.admin / claims.role like Firebase custom claims.
 */
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { getSupabase } from './client';

export interface UserInfo {
  providerId: string;
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export interface IdTokenResult {
  token: string;
  claims: Record<string, unknown>;
  expirationTime: string;
  issuedAtTime: string;
  signInProvider: string | null;
}

export interface User extends UserInfo {
  emailVerified: boolean;
  isAnonymous: boolean;
  tenantId: string | null;
  providerData: UserInfo[];
  metadata: { creationTime?: string; lastSignInTime?: string };
  getIdToken(forceRefresh?: boolean): Promise<string>;
  getIdTokenResult(forceRefresh?: boolean): Promise<IdTokenResult>;
  reload(): Promise<void>;
}

export interface UserCredential {
  user: User;
  /** True when the account uses an authenticator app and the code step is still needed. */
  secondFactorRequired?: boolean;
}

export class AuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FirebaseError';
  }
}

function fail(error: { message: string; code?: string; status?: number } | null, fallbackCode: string): never {
  throw new AuthError(`auth/${error?.code || fallbackCode}`, error?.message || 'Sign-in failed');
}

function decodeJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    const json = typeof atob === 'function'
      ? atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
      : Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return {};
  }
}

async function currentAccessToken(forceRefresh = false): Promise<string> {
  const supabase = getSupabase();
  if (forceRefresh) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) fail(error, 'token-refresh-failed');
    return data.session.access_token;
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new AuthError('auth/no-current-user', 'Not signed in');
  return data.session.access_token;
}

function toUser(u: SupabaseUser): User {
  const meta = (u.user_metadata || {}) as Record<string, string | undefined>;
  const displayName = meta.full_name || meta.name || null;
  const photoURL = meta.avatar_url || meta.picture || null;
  const provider = (u.app_metadata?.provider as string | undefined) || 'email';
  const providerData: UserInfo[] = (u.identities || []).map(identity => ({
    providerId: identity.provider === 'email' ? 'password' : `${identity.provider}.com`,
    uid: identity.id,
    displayName,
    email: (identity.identity_data?.email as string | undefined) || u.email || null,
    photoURL,
  }));
  return {
    providerId: 'supabase',
    uid: u.id,
    email: u.email || null,
    displayName,
    photoURL,
    emailVerified: Boolean(u.email_confirmed_at),
    isAnonymous: Boolean(u.is_anonymous),
    tenantId: null,
    providerData,
    metadata: { creationTime: u.created_at, lastSignInTime: u.last_sign_in_at },
    getIdToken: (forceRefresh?: boolean) => currentAccessToken(forceRefresh),
    async getIdTokenResult(forceRefresh?: boolean): Promise<IdTokenResult> {
      const token = await currentAccessToken(forceRefresh);
      const payload = decodeJwt(token);
      const appMeta = (payload.app_metadata || {}) as Record<string, unknown>;
      const claims: Record<string, unknown> = {
        ...payload,
        admin: appMeta.admin === true,
        role: appMeta.role === 'admin' ? 'admin' : payload.role,
      };
      const exp = typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : '';
      const iat = typeof payload.iat === 'number' ? new Date(payload.iat * 1000).toISOString() : '';
      return { token, claims, expirationTime: exp, issuedAtTime: iat, signInProvider: provider };
    },
    async reload() {
      await getSupabase().auth.refreshSession();
    },
  };
}

/**
 * The verified authenticator factor still to be confirmed with a code, if any: the session
 * has only passed the password step (aal1) but the account has an authenticator app.
 */
function pendingFactorId(session: Session): string | null {
  const factor = (session.user.factors || []).find(f => f.factor_type === 'totp' && f.status === 'verified');
  if (!factor) return null;
  return decodeJwt(session.access_token).aal === 'aal2' ? null : factor.id;
}

// ---------------------------------------------------------------------------
// Auth object
// ---------------------------------------------------------------------------

type Listener = (user: User | null) => void;
type FactorListener = (factorId: string | null) => void;
type RecoveryListener = (recovering: boolean) => void;

export class Auth {
  currentUser: User | null = null;
  /** Set while the password step is done but the authenticator code is still needed. */
  pendingSecondFactor: string | null = null;
  private listeners = new Set<Listener>();
  private factorListeners = new Set<FactorListener>();
  /** Y-31: signed in from a password-reset link; a new password is still to be chosen. */
  passwordRecovery = false;
  private recoveryListeners = new Set<RecoveryListener>();
  private ready = false;
  private started = false;

  private start() {
    if (this.started) return;
    this.started = true;
    const supabase = getSupabase();
    const apply = (session: Session | null) => {
      // Until the code step is done the app treats the user as signed out (the database and
      // the server refuse such a session anyway).
      const pending = session ? pendingFactorId(session) : null;
      this.pendingSecondFactor = pending;
      this.currentUser = session?.user && !pending ? toUser(session.user) : null;
      this.ready = true;
      this.listeners.forEach(l => l(this.currentUser));
      this.factorListeners.forEach(l => l(pending));
    };
    void supabase.auth.getSession().then(({ data }) => apply(data.session));
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      if (event === 'PASSWORD_RECOVERY') this.setRecovery(true);
      apply(session);
    });
  }

  onAuthStateChanged(listener: Listener): () => void {
    this.start();
    this.listeners.add(listener);
    if (this.ready) listener(this.currentUser);
    return () => { this.listeners.delete(listener); };
  }

  onSecondFactorChanged(listener: FactorListener): () => void {
    this.start();
    this.factorListeners.add(listener);
    if (this.ready) listener(this.pendingSecondFactor);
    return () => { this.factorListeners.delete(listener); };
  }

  setRecovery(value: boolean) {
    this.passwordRecovery = value;
    this.recoveryListeners.forEach(l => l(value));
  }

  onPasswordRecovery(listener: RecoveryListener): () => void {
    this.start();
    this.recoveryListeners.add(listener);
    listener(this.passwordRecovery);
    return () => { this.recoveryListeners.delete(listener); };
  }

  async signOut(): Promise<void> {
    const { error } = await getSupabase().auth.signOut();
    if (error) fail(error, 'sign-out-failed');
  }
}

let defaultAuth: Auth | null = null;
export function getAuth(): Auth {
  if (!defaultAuth) defaultAuth = new Auth();
  return defaultAuth;
}

export function onAuthStateChanged(auth: Auth, listener: Listener): () => void {
  return auth.onAuthStateChanged(listener);
}

export function signOut(auth: Auth): Promise<void> {
  return auth.signOut();
}

export async function signInWithEmailAndPassword(_auth: Auth, email: string, password: string): Promise<UserCredential> {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error || !data.user) fail(error, 'invalid-credential');
  return { user: toUser(data.user), secondFactorRequired: data.session ? pendingFactorId(data.session) !== null : false };
}

/** Calls the listener with the factor id while an authenticator code is needed, else null. */
export function onSecondFactorRequired(auth: Auth, listener: FactorListener): () => void {
  return auth.onSecondFactorChanged(listener);
}

/** Finishes sign-in with the 6-digit code from the authenticator app. */
export async function verifySecondFactor(auth: Auth, code: string): Promise<void> {
  const factorId = auth.pendingSecondFactor;
  if (!factorId) return;
  const { error } = await getSupabase().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (error) fail(error, 'invalid-verification-code');
}

export async function createUserWithEmailAndPassword(_auth: Auth, email: string, password: string): Promise<UserCredential> {
  const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
  const { data, error } = await getSupabase().auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
  if (error || !data.user) fail(error, 'signup-failed');
  return { user: toUser(data.user) };
}

/** Supabase already sends the confirmation email on sign-up; this re-sends it. */
export async function sendEmailVerification(user: User): Promise<void> {
  if (!user.email || user.emailVerified) return;
  const { error } = await getSupabase().auth.resend({ type: 'signup', email: user.email });
  // Re-sending right after sign-up is rate limited; the first email is already on its way.
  if (error && !/rate limit|seconds/i.test(error.message)) fail(error, 'verification-failed');
}

/** Y-31: someone arriving from a password-reset link chooses a new password (rules: src/lib/passwordPolicy.ts). */
export function onPasswordRecovery(auth: Auth, listener: RecoveryListener): () => void {
  return auth.onPasswordRecovery(listener);
}

export async function setNewPassword(auth: Auth, password: string): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({ password });
  if (error) fail(error, 'password-update-failed');
  auth.setRecovery(false);
}

export async function sendPasswordResetEmail(_auth: Auth, email: string): Promise<void> {
  const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) fail(error, 'reset-failed');
}

export class GoogleAuthProvider {
  readonly providerId = 'google.com';
  private scopes: string[] = [];
  addScope(scope: string): GoogleAuthProvider { this.scopes.push(scope); return this; }
  get scopeString(): string { return this.scopes.join(' '); }
}

/**
 * Google sign-in. Supabase uses a full-page redirect instead of a popup: the browser
 * leaves and comes back signed in, and onAuthStateChanged fires then.
 */
export async function signInWithPopup(_auth: Auth, provider: GoogleAuthProvider): Promise<UserCredential> {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      scopes: provider.scopeString || undefined,
    },
  });
  if (error) fail(error, 'popup-closed-by-user');
  // The page is navigating away; this promise never needs to resolve.
  return new Promise<UserCredential>(() => {});
}

// ---------------------------------------------------------------------------
// Two-step sign-in (authenticator app / TOTP)
// ---------------------------------------------------------------------------

export interface TotpSecret {
  readonly secretKey: string;
  readonly factorId: string;
  readonly qrCodeSvg: string;
  generateQrCodeUrl(accountName?: string, issuer?: string): string;
}

export interface MultiFactorAssertion { readonly factorId: string; readonly code: string }

async function requireMfaUser(userId: string): Promise<void> {
  const { data, error } = await getSupabase().auth.getUser();
  if (error) fail(error, 'mfa-user-check-failed');
  if (!data.user || data.user.id !== userId) throw new AuthError('auth/user-changed', 'Your sign-in changed. Reload Security settings.');
}

function requireTotpCode(code: string): string {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) throw new AuthError('auth/invalid-verification-code', 'Enter the current 6-digit authenticator code.');
  return trimmed;
}

export const TotpMultiFactorGenerator = {
  FACTOR_ID: 'totp',
  async generateSecret(session: { userId: string }): Promise<TotpSecret> {
    await requireMfaUser(session.userId);
    const { data, error } = await getSupabase().auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16)}`,
    });
    if (error || !data) fail(error, 'mfa-enroll-failed');
    const totp = (data as { id: string; totp: { secret: string; uri: string; qr_code: string } });
    return {
      secretKey: totp.totp.secret,
      factorId: totp.id,
      qrCodeSvg: totp.totp.qr_code,
      generateQrCodeUrl: () => totp.totp.uri,
    };
  },
  assertionForEnrollment(secret: TotpSecret, code: string): MultiFactorAssertion {
    return { factorId: secret.factorId, code };
  },
  assertionForSignIn(factorId: string, code: string): MultiFactorAssertion {
    return { factorId, code };
  },
};

export function multiFactor(user: User) {
  const getFactors = async () => {
    await requireMfaUser(user.uid);
    const { data, error } = await getSupabase().auth.mfa.listFactors();
    if (error || !data) fail(error, 'mfa-list-failed');
    return data.all.filter(f => f.factor_type === 'totp');
  };
  return {
    async getSession(): Promise<{ userId: string }> {
      await requireMfaUser(user.uid);
      return { userId: user.uid };
    },
    async enroll(assertion: MultiFactorAssertion, _displayName?: string): Promise<void> {
      const supabase = getSupabase();
      const code = requireTotpCode(assertion.code);
      await requireMfaUser(user.uid);
      const challenge = await supabase.auth.mfa.challenge({ factorId: assertion.factorId });
      if (challenge.error || !challenge.data) fail(challenge.error, 'mfa-challenge-failed');
      await requireMfaUser(user.uid);
      const verify = await supabase.auth.mfa.verify({
        factorId: assertion.factorId,
        challengeId: challenge.data.id,
        code,
      });
      if (verify.error) fail(verify.error, 'invalid-verification-code');
    },
    async getEnrolledFactors() {
      return (await getFactors()).filter(f => f.status === 'verified');
    },
    getFactors,
    async remove(factorId: string, code: string): Promise<void> {
      const currentCode = requireTotpCode(code);
      if (!(await getFactors()).some(f => f.id === factorId && f.status === 'verified')) throw new AuthError('auth/mfa-factor-not-found', 'This authenticator is no longer enrolled. Reload Security settings.');
      await requireMfaUser(user.uid);
      const { error: verificationError } = await getSupabase().auth.mfa.challengeAndVerify({ factorId, code: currentCode });
      if (verificationError) fail(verificationError, 'invalid-verification-code');
      await requireMfaUser(user.uid);
      const { error } = await getSupabase().auth.mfa.unenroll({ factorId });
      if (error) fail(error, 'mfa-remove-failed');
    },
    async cancelEnrollment(factorId: string): Promise<void> {
      if (!(await getFactors()).some(f => f.id === factorId && f.status === 'unverified')) throw new AuthError('auth/mfa-factor-not-pending', 'Only an unfinished authenticator setup can be canceled.');
      await requireMfaUser(user.uid);
      const { error } = await getSupabase().auth.mfa.unenroll({ factorId });
      if (error) fail(error, 'mfa-cancel-failed');
    },
  };
}

// ---------------------------------------------------------------------------
// Passkeys (CC-12): sign in with the device's fingerprint, face or PIN instead of a password.
// Supabase Auth runs the WebAuthn ceremony; a passkey is added from Security settings while signed in.
// A user with an authenticator app still gives its code after a passkey sign-in (pendingFactorId reads
// the session's level the same way), so a passkey never skips the second step.
// ---------------------------------------------------------------------------

export interface PasskeyInfo { id: string; name: string; createdAt: string; lastUsedAt?: string }

export const MAX_PASSKEY_NAME = 60;

/** Whether this browser can use passkeys at all (WebAuthn available on a secure page). */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true
    && typeof window.PublicKeyCredential === 'function' && typeof navigator !== 'undefined' && Boolean(navigator.credentials);
}

/** A passkey's name as shown and saved: trimmed, at most MAX_PASSKEY_NAME characters, never empty. */
export function passkeyName(name: string | undefined, fallback = 'Passkey'): string {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_PASSKEY_NAME);
  return clean || fallback;
}

/** True when the error means passkeys are not switched on for this site yet (Supabase Auth setting). */
export function passkeysOff(e: unknown): boolean {
  const code = e instanceof AuthError ? e.code : '';
  return /passkey.*(disabled|not_enabled)|webauthn.*not_enabled|provider_disabled/i.test(code);
}

export async function signInWithPasskey(_auth: Auth): Promise<UserCredential> {
  const { data, error } = await getSupabase().auth.signInWithPasskey();
  const session = data?.session;
  if (error || !session?.user) fail(error, 'passkey-sign-in-failed');
  return { user: toUser(session.user), secondFactorRequired: pendingFactorId(session) !== null };
}

export async function listPasskeys(): Promise<PasskeyInfo[]> {
  const { data, error } = await getSupabase().auth.passkey.list();
  if (error) fail(error, 'passkey-list-failed');
  return (data || []).map(p => ({ id: p.id, name: passkeyName(p.friendly_name), createdAt: p.created_at, ...(p.last_used_at ? { lastUsedAt: p.last_used_at } : {}) }));
}

/**
 * Adds a passkey and, when a name is given, saves it. The passkey works as soon as it is registered, so a
 * failed rename is reported in the result (named: false), never thrown: the caller still lists the new passkey.
 */
export async function addPasskey(name?: string): Promise<{ id: string; named: boolean }> {
  const { data, error } = await getSupabase().auth.registerPasskey();
  if (error || !data) fail(error, 'passkey-register-failed');
  const clean = passkeyName(name, '');
  if (!clean || clean === data.friendly_name) return { id: data.id, named: true };
  const renamed = await getSupabase().auth.passkey.update({ passkeyId: data.id, friendlyName: clean });
  return { id: data.id, named: !renamed.error };
}

export async function renamePasskey(id: string, name: string): Promise<void> {
  const clean = passkeyName(name, '');
  if (!clean) throw new AuthError('auth/passkey-name-empty', 'Give the passkey a name.');
  const { error } = await getSupabase().auth.passkey.update({ passkeyId: id, friendlyName: clean });
  if (error) fail(error, 'passkey-rename-failed');
}

export async function removePasskey(id: string): Promise<void> {
  const { error } = await getSupabase().auth.passkey.delete({ passkeyId: id });
  if (error) fail(error, 'passkey-delete-failed');
}
