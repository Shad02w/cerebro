export function changeItemId(repositoryId: number, path: string): string {
  return `${repositoryId}:${path}`
}
