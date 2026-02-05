export interface Task {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'prompt' | 'claude_output';
  content: string;
}

export interface AppState {
  tasks: Task[];
  messages: Message[];
  isLoading: boolean;
  input: string;
}
