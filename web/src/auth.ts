import { fetchAuthSession, getCurrentUser, signIn, signOut } from 'aws-amplify/auth';
import { AppError } from './errors';

export async function login(username: string, password: string): Promise<void> {
  // Amplify v6 defaults to USER_SRP_AUTH
  const res = await signIn({ username, password });
  if (!res.isSignedIn) throw new AppError('signInNextStep', res.nextStep.signInStep);
}

export async function logout(): Promise<void> {
  await signOut();
}

export async function currentUser(): Promise<string | null> {
  try {
    const u = await getCurrentUser();
    return u.signInDetails?.loginId ?? u.username;
  } catch {
    return null;
  }
}

export async function idToken(): Promise<string> {
  const s = await fetchAuthSession();
  const t = s.tokens?.idToken?.toString();
  if (!t) throw new Error('not signed in');
  return t;
}
