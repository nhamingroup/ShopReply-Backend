import { useState, useEffect, useCallback } from 'react';
import type {
  MatchResult,
  SendResult,
  HealthResult,
  LLMSuggestResult,
  StatsResult,
  ExtensionResponse,
  ExtensionMessage,
  Platform,
  ReplyType,
} from '@/types/messages';

function sendMsg<T>(msg: ExtensionMessage): Promise<ExtensionResponse<T>> {
  return new Promise((resolve) => {
    browser.runtime.sendMessage(msg).then(
      (response) => resolve(response as ExtensionResponse<T>),
      (err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : 'Extension communication error';
        resolve({ success: false, error: errorMsg });
      }
    );
  });
}

const STORAGE_KEY_STATUS = 'shopreply_backend_status';

export function useBackend() {
  const [isConnected, setIsConnected] = useState(false);
  const [healthData, setHealthData] = useState<HealthResult | null>(null);

  // Read cached status from storage immediately (set by background script)
  useEffect(() => {
    browser.storage.local.get(STORAGE_KEY_STATUS).then((r) => {
      const cached = r[STORAGE_KEY_STATUS] as { online?: boolean; health?: HealthResult } | undefined;
      if (cached) {
        setIsConnected(cached.online ?? false);
        if (cached.health) setHealthData(cached.health);
      }
    });
  }, []);

  const checkHealth = useCallback(async (): Promise<ExtensionResponse<HealthResult>> => {
    const result = await sendMsg<HealthResult>({ type: 'MSG_HEALTH', payload: {} });
    const health = result.data;
    setIsConnected(result.success && health?.status === 'ok');
    if (result.success && health) {
      setHealthData(health);
    }
    return result;
  }, []);

  const matchQuestion = useCallback(async (
    question: string,
    platform: Platform,
    conversationId: string,
    senderName?: string
  ): Promise<ExtensionResponse<MatchResult>> => {
    return sendMsg<MatchResult>({
      type: 'MSG_MATCH',
      payload: { question, platform, conversation_id: conversationId, sender_name: senderName },
    });
  }, []);

  const sendReply = useCallback(async (params: {
    messageId: number;
    replyText: string;
    replyType: ReplyType;
    qaId: number | null;
    originalQuestion: string;
    platform: Platform;
    conversationId: string;
  }): Promise<ExtensionResponse<SendResult>> => {
    return sendMsg<SendResult>({
      type: 'MSG_SEND',
      payload: {
        message_id: params.messageId,
        reply_text: params.replyText,
        reply_type: params.replyType,
        qa_id: params.qaId,
        original_question: params.originalQuestion,
        platform: params.platform,
        conversation_id: params.conversationId,
      },
    });
  }, []);

  const llmSuggest = useCallback(async (
    question: string,
    context?: { similar_qa?: Array<{ question: string; answer: string }>; shop_info?: string; tone?: string }
  ): Promise<ExtensionResponse<LLMSuggestResult>> => {
    return sendMsg<LLMSuggestResult>({
      type: 'MSG_LLM_SUGGEST',
      payload: { question, context },
    });
  }, []);

  const getStats = useCallback(async (period: string = 'today'): Promise<ExtensionResponse<StatsResult>> => {
    return sendMsg<StatsResult>({
      type: 'MSG_GET_STATS',
      payload: { period },
    });
  }, []);

  // Health check on mount + periodic polling
  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30_000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  return {
    isConnected,
    healthData,
    checkHealth,
    matchQuestion,
    sendReply,
    llmSuggest,
    getStats,
  };
}
