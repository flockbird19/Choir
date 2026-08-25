'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function updateDisplayName(name: string) {
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({
    data: { full_name: name.trim() }
  })
  if (error) return { error: error.message }
  revalidatePath('/profile')
  return { success: true }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
