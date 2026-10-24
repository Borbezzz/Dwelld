/** Resolve authentication on our explicit domains without trusting arbitrary request hosts. */
export function authBaseURL(env: { BETTER_AUTH_URL?: string; VERCEL_URL?: string; NODE_ENV?: string } = process.env) {
  const allowedHosts = ['dwelld.dev', 'www.dwelld.dev', 'dwelld.vercel.app'];
  if (env.BETTER_AUTH_URL) allowedHosts.push(new URL(env.BETTER_AUTH_URL).host);
  if (env.VERCEL_URL) allowedHosts.push(new URL(`https://${env.VERCEL_URL}`).host);
  if (env.NODE_ENV !== 'production') allowedHosts.push('localhost:*', '127.0.0.1:*');
  return { allowedHosts: [...new Set(allowedHosts)], protocol: 'auto' as const, fallback: env.BETTER_AUTH_URL || 'https://www.dwelld.dev' };
}
