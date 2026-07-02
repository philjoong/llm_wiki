/**
 * Data model for persona-based play scenarios.
 * See docs/new-feature-dev-plan.md §3.
 */

export interface Persona {
  id: string
  name: string
  description: string
  traits: string[]
}

export interface PlayScenario {
  id: string
  personaId: string
  title: string
  steps: string[]
  createdAt: number
}

export function createPersona(name: string, description = "", traits: string[] = []): Persona {
  return { id: crypto.randomUUID(), name, description, traits }
}
