import sv from 'semver'

// Minimal glob → RegExp. Package names and advisory ids use a small charset, so
// escape the regex metachars and turn `*` into a wildcard run.
const globToRegExp = (glob: string): RegExp =>
  new RegExp(
    `^${glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')}$`,
  )

const split = (raw?: string | string[]): string[] =>
  (Array.isArray(raw) ? raw : [raw ?? ''])
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim())
    .filter(Boolean)

/** A parsed `--exclude` rule: a package-name glob + an optional semver range. */
export type TPackageRule = (name: string, version: string) => boolean

/**
 * Parse `--exclude`: comma-separated package rules `glob[@range]` — e.g.
 * `lodash`, `@scope/*`, `pkg@>=2 <3`. A package matches when its name matches the
 * glob and, if a range is given, its installed version satisfies it.
 */
export const parsePackageRules = (raw?: string | string[]): TPackageRule[] =>
  split(raw).map((item) => {
    // Scoped names start with `@`, so the range separator is the *next* `@`.
    const at = item.startsWith('@') ? item.indexOf('@', 1) : item.indexOf('@')
    const name = at === -1 ? item : item.slice(0, at)
    const range = at === -1 ? '' : item.slice(at + 1).trim()
    const glob = globToRegExp(name)

    return (n: string, v: string): boolean =>
      glob.test(n) && (!range || (!!sv.valid(v) && sv.satisfies(v, range)))
  })

/** True when `name@version` matches any package rule. */
export const matchesPackage = (
  name: string,
  version: string,
  rules: TPackageRule[],
): boolean => rules.some((rule) => rule(name, version))

/** Parse `--ignore`: comma-separated globs matched against advisory ids. */
export const parseIdGlobs = (raw?: string | string[]): RegExp[] =>
  split(raw).map(globToRegExp)

/** True when any of `ids` (npm advisory id / CVE / GHSA) matches any glob. */
export const matchesId = (ids: string[], globs: RegExp[]): boolean =>
  globs.length > 0 && ids.some((id) => globs.some((g) => g.test(id)))
