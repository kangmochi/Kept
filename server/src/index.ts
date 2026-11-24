import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { createApp, type NotionOps } from './app.js'
import { loadEnvFiles, readEnv } from './env.js'
import { NotionClient } from './notion.js'
import { createLlmClient, createTranscriber } from './providers.js'

loadEnvFiles()
const env = readEnv()

if (env.ephemeralSecret) {
  console.log('SESSION_SECRET is empty. Using an ephemeral secret for this process only.')
}

const notion = await prepareNotion()
const app = createApp({
  env,
  llm: createLlmClient(env.llmBaseUrl, env.llmApiKey, env.llmModel),
  transcribe: createTranscriber(env.sttBaseUrl, env.sttApiKey, env.sttModel),
  notion,
  remoteAddress: (c) => getConnInfo(c).remote.address,
})

serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
  console.log(`Kept server listening on http://${info.address}:${info.port}`)
})

async function prepareNotion(): Promise<NotionOps> {
  const missing = [
    !env.notionToken ? 'NOTION_TOKEN' : '',
    !env.notionDatabaseId ? 'NOTION_DATABASE_ID' : '',
    !env.notionDataSourceId ? 'NOTION_DATA_SOURCE_ID' : '',
  ].filter(Boolean)

  let dataSourceId = env.notionDataSourceId
  if (!dataSourceId && env.notionToken && env.notionDatabaseId && env.allowDevPair) {
    dataSourceId = await discoverDataSource(env.notionToken, env.notionDatabaseId)
  }

  if (!env.notionToken || !dataSourceId) {
    const reason = missing.length
      ? `Notion is not configured. Set ${missing.join(', ')} in .env. The database Keep — promises already exists; do not create another one.`
      : 'Notion is not configured.'
    console.log(reason)
    return unavailable(reason)
  }

  const client = new NotionClient({
    token: env.notionToken,
    databaseId: env.notionDatabaseId,
    dataSourceId,
    timeZone: env.tz,
  })
  try {
    await client.checkSchema()
    console.log('Notion schema check passed for Keep — promises.')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Notion schema check failed'
    console.error(message)
    if (env.notionToken && env.notionDatabaseId && env.notionDataSourceId) {
      process.exit(1)
    }
    return unavailable(message)
  }
  return client
}

async function discoverDataSource(token: string, databaseId: string): Promise<string> {
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2026-03-11',
      },
    })
    if (!response.ok) return ''
    const data = (await response.json()) as { data_sources?: { id?: string }[] }
    const sources = data.data_sources ?? []
    if (sources.length > 1) {
      console.log('The database has more than one data source. Set NOTION_DATA_SOURCE_ID to choose one.')
    }
    if (sources[0]?.id) {
      console.log('NOTION_DATA_SOURCE_ID is unset. Using the data source discovered for this local run. Set the env var before any hosted deploy.')
      return sources[0].id
    }
  } catch {
    console.log('Could not discover a Notion data source. Set NOTION_DATA_SOURCE_ID.')
  }
  return ''
}

function unavailable(reason: string): NotionOps {
  return {
    queryOpen: async () => {
      throw new Error(reason)
    },
    create: async () => {
      throw new Error(reason)
    },
    markDone: async () => {
      throw new Error(reason)
    },
  }
}
