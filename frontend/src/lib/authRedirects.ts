const trimSlash = (value: string) => value.replace(/\/+$/, '')

export function authRedirect(path: '/login' | '/reset-password') {
  if (import.meta.env.DEV && import.meta.env.VITE_USE_LOCAL_PROXY === 'true') {
    return `${window.location.origin}${path}`
  }
  const explicit = path === '/login'
    ? import.meta.env.VITE_AUTH_REDIRECT_URL
    : import.meta.env.VITE_PASSWORD_RESET_REDIRECT_URL

  if (explicit) return explicit

  const siteUrl = import.meta.env.VITE_SITE_URL
  if (siteUrl) return `${trimSlash(siteUrl)}${path}`

  return `${window.location.origin}${path}`
}
