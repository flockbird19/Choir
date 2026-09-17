export interface Team {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}

export interface Project {
  id: string;
  team_id: string;
  name: string;
  created_by: string;
  shared_model_provider?: string;
  shared_model_name?: string;
  shared_model_key_id?: string;
  created_at: string;
}

export interface Thread {
  id: string;
  project_id: string;
  type: 'shared' | 'private';
  owner_id?: string;
  name?: string;
  model_provider?: string;
  model_name?: string;
  created_at: string;
  // Private threads: the AI answers every message unless muted. Missing until the
  // schema.sql re-run adds the column, so treat undefined as true.
  ai_auto_reply?: boolean;
  // D2: set when the thread was started with "Discuss privately" on a Team Space message.
  forked_from_message_id?: string | null;
}

export interface Message {
  id: string;
  thread_id: string;
  sender_type: 'user' | 'assistant';
  sender_id?: string;
  content: string;
  model_provider?: string;
  model_name?: string;
  created_at: string;
  shared_by?: string;
  is_decision?: boolean;
  pinned_by?: string | null;
  pinned_at?: string | null;
  // K2: set on a Team Space post published from the poster's own private thread.
  source_thread_id?: string | null;
}

export interface TeamInvitation {
  id: string;
  team_id: string;
  token: string;
  created_by: string;
  created_at: string;
}
