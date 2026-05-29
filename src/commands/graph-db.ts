import { invoke } from "@tauri-apps/api/core"
import { loadFalkordbUrl } from "@/lib/project-store"

async function getUrl(): Promise<string | undefined> {
  return (await loadFalkordbUrl()) ?? undefined
}

export async function createGraphDb(graphName: string): Promise<void> {
  return invoke<void>("graph_db_create", { graphName, url: await getUrl() })
}

export async function deleteGraphDb(graphName: string): Promise<void> {
  return invoke<void>("graph_db_delete", { graphName, url: await getUrl() })
}

export async function listGraphDb(): Promise<string[]> {
  return invoke<string[]>("graph_db_list", { url: await getUrl() })
}

export async function pingGraphDb(): Promise<void> {
  return invoke<void>("graph_db_ping", { url: await getUrl() })
}
