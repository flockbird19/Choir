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
}
