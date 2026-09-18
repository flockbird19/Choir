'use server'

import { createClient } from '@/utils/supabase/server'
import { getCurrentUser } from '@/utils/supabase/access'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export type StatusId = 'online' | 'away' | 'dnd' | 'offline'

const STATUS_IDS: StatusId[] = ['online', 'away', 'dnd', 'offline']

export async function updateDisplayName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Enter a name.' }

  const user = await getCurrentUser()
  if (!user) return { error: 'Not signed in.' }

  const supabase = await createClient()

  // E4: `profiles` is what teammates and the AI read (no delay, no admin-API call).
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: trimmed, updated_at: new Date().toISOString() })
    .eq('id', user.id)
  if (error) return { error: error.message }

  // Keep it in the session too, so surfaces that still read the name off the
  // signed-in user (rather than `profiles`) see the change immediately as well.
  const { error: authError } = await supabase.auth.updateUser({ data: { full_name: trimmed } })
  if (authError) return { error: authError.message }
  await supabase.auth.refreshSession()

  revalidatePath('/', 'layout')
  return { success: true }
}

export async function updateStatus(status: StatusId) {
  if (!STATUS_IDS.includes(status)) return { error: 'Unknown status.' }

  const user = await getCurrentUser()
  if (!user) return { error: 'Not signed in.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('profiles')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', user.id)
  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  return { success: true }
}

// Real, shared state now (profiles.status), read fresh so the sidebar reflects a
// change made on another tab or device — not the old per-browser `localStorage`.
export async function getMyStatus(): Promise<StatusId> {
  const user = await getCurrentUser()
  if (!user) return 'online'

  const supabase = await createClient()
  const { data } = await supabase.from('profiles').select('status').eq('id', user.id).single()
  const status = data?.status as StatusId | null | undefined
  return status && STATUS_IDS.includes(status) ? status : 'online'
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
