export interface QAPair {
  id: number
  question: string
  answer: string
  source: 'imported' | 'history_scan' | 'user_replied' | 'ai_approved'
  times_auto_sent: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface QAImportPayload {
  pairs: Array<{ question: string; answer: string }>
  source?: string
}

export interface Suggestion {
  answer: string
  qa_id: number
  similarity: number
  source: 'database' | 'llm'
}
