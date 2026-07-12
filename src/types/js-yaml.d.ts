declare module "js-yaml" {
  export function load(content: string, options?: Record<string, unknown>): unknown
  export function dump(value: unknown): string

  const yaml: {
    load: typeof load
    dump: typeof dump
  }

  export default yaml
}
