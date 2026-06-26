import type { AppData } from './types'
import { DEFAULT_SETTINGS, emptyData } from './storage'

// Optional Google Drive backup. Uses Google Identity Services (GIS) with the
// `drive.file` scope — the app can ONLY see files it creates itself, never the
// rest of the user's Drive. The access token lives in memory only; nothing is
// sent anywhere except directly between the browser and Google's API.

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const FILE_NAME = 'casaressan-finances-backup.json'

type AnyWindow = typeof window & { google?: any }

let gisLoading: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (gisLoading) return gisLoading
  gisLoading = new Promise((resolve, reject) => {
    const w = window as AnyWindow
    if (w.google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection.'))
    document.head.appendChild(s)
  })
  return gisLoading
}

let accessToken: string | null = null
let tokenExpiry = 0
let tokenClient: any = null
let tokenClientId = ''

export function isDriveConnected(): boolean {
  return Boolean(accessToken) && Date.now() < tokenExpiry - 60_000
}

function getAccessToken(clientId: string, interactive: boolean): Promise<string> {
  if (isDriveConnected()) return Promise.resolve(accessToken!)
  return loadGis().then(
    () =>
      new Promise<string>((resolve, reject) => {
        const w = window as AnyWindow
        if (!w.google?.accounts?.oauth2) {
          reject(new Error('Google sign-in is not available.'))
          return
        }
        if (!tokenClient || tokenClientId !== clientId) {
          tokenClientId = clientId
          tokenClient = w.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: SCOPE,
            callback: () => {},
          })
        }
        tokenClient.callback = (resp: any) => {
          if (resp.error) {
            reject(new Error(resp.error_description || resp.error))
            return
          }
          accessToken = resp.access_token
          tokenExpiry = Date.now() + (resp.expires_in ?? 3600) * 1000
          resolve(accessToken!)
        }
        try {
          tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' })
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Google sign-in failed.'))
        }
      }),
  )
}

function requireClientId(clientId?: string): string {
  const id = clientId?.trim()
  if (!id) throw new Error('Add your Google OAuth Client ID first.')
  return id
}

/** Trigger the consent popup and obtain an access token. */
export async function connectDrive(clientId?: string): Promise<void> {
  await getAccessToken(requireClientId(clientId), true)
}

async function findFileId(token: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`)
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`Drive lookup failed (${res.status}).`)
  const json = await res.json()
  return json.files?.[0]?.id ?? null
}

/** Save the dataset to Drive, creating or updating the backup file. */
export async function saveToDrive(data: AppData, clientId?: string): Promise<string> {
  const id = requireClientId(clientId)
  const token = await getAccessToken(id, false)
  const existing = data.settings.driveFileId || (await findFileId(token))
  const payload = JSON.stringify(data, null, 2)

  if (existing) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media&fields=id`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: payload,
      },
    )
    if (res.ok) return existing
    // File may have been deleted — fall through to create a fresh one.
  }

  const boundary = 'casaressan' + Date.now()
  const metadata = { name: FILE_NAME, mimeType: 'application/json' }
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    `${payload}\r\n--${boundary}--`
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )
  if (!res.ok) throw new Error(`Saving to Drive failed (${res.status}).`)
  const json = await res.json()
  return json.id as string
}

/** Load the dataset back from the Drive backup file. */
export async function loadFromDrive(clientId?: string): Promise<AppData> {
  const id = requireClientId(clientId)
  const token = await getAccessToken(id, false)
  const fileId = await findFileId(token)
  if (!fileId) throw new Error('No CasaresSan Finances backup found in your Drive yet.')
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Reading from Drive failed (${res.status}).`)
  const parsed = (await res.json()) as AppData
  if (!parsed || typeof parsed !== 'object' || !('version' in parsed)) {
    throw new Error('The Drive backup is not a valid CasaresSan Finances file.')
  }
  // Preserve on-device secrets (API key) and the Drive file id we just used.
  return {
    ...emptyData(),
    ...parsed,
    settings: { ...DEFAULT_SETTINGS, ...parsed.settings, driveFileId: fileId },
    updatedAt: new Date().toISOString(),
  }
}
