import { createClient } from './server'

export async function getUserTeams() {
  const supabase = await createClient()
  // RLS ensures we only get teams we are a member of
  const { data, error } = await supabase.from('teams').select('*')
  
  if (error) {
    console.error('Error fetching teams:', error)
    return []
  }
  return data
}

export async function getProjects(teamId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('team_id', teamId)
  
  if (error) {
    console.error('Error fetching projects:', error)
    return []
  }
  return data
}

export async function getThreads(projectId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('threads')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('Error fetching threads:', error)
    return []
  }
  return data
}

export async function getMessages(threadId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
  
  if (error) {
    console.error('Error fetching messages:', error)
    return []
  }
  return data
}
