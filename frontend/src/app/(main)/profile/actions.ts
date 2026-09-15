'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { forgetMemberName } from '@/utils/supabase/member-names'

export async function updateDisplayName(name: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.updateUser({
    data: { full_name: name.trim() }
  })
  if (error) return { error: error.message }
  if (data.user) forgetMemberName(data.user.id)
  // Re-issue the session so the browser's token carries the new name too.
  await supabase.auth.refreshSession()
  revalidatePath('/', 'layout')
  return { success: true }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
