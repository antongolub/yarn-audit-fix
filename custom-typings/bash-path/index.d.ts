declare module 'bash-path' {
  function getBashPath(paths?: string[]): string | null
  export = getBashPath
}
