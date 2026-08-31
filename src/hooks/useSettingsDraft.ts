import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { App as AntdApp } from 'antd';
import type { AIConfig } from '../schemas/ai-config';
import { parseConfigJSON, stringifyConfig } from '../storage/settings';
import { INTERVIEW_AGENT_OPENING_INSTRUCTION } from '../agent/prompt';

export interface PromptDraft {
  /** 用户自定义指令（目标 / 风格 / 偏好层）；为空表示仅用内置安全层 + 契约层。 */
  agentInstructions: string;
  /** Agent 开场指令（首轮 user 消息）；为空回退默认 `INTERVIEW_AGENT_OPENING_INSTRUCTION`。 */
  agentOpening: string;
}

/**
 * 设置页的「未保存草稿」编辑态。
 * 提升到 App 层与 useAgentInterview / useTrainingSession 同思路：切 tab（如去训练/进度页）
 * 再切回设置时，正在编辑的 provider、熟练度、提示词、JSON 草稿不丢失。
 * config 仅在主动保存时变化，因此 useEffect([config]) 只在保存后把草稿同步回已保存值，
 * 不会在切 tab 时清掉草稿。
 */
export interface SettingsEditor {
  draft: AIConfig;
  setDraft: Dispatch<SetStateAction<AIConfig>>;
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  promptDraft: PromptDraft;
  setPromptDraft: Dispatch<SetStateAction<PromptDraft>>;
  activeTab: string;
  setActiveTab: Dispatch<SetStateAction<string>>;
  updateProvider: (index: number, patch: Partial<AIConfig['providers'][number]>) => void;
  moveProvider: (index: number, direction: -1 | 1) => void;
  updateProficiency: (key: keyof AIConfig['proficiency'], value: number | null) => void;
  handleFormSave: () => void;
  handlePromptSave: () => void;
  handleSave: () => void;
}

export function useSettingsDraft(
  config: AIConfig,
  onSave: (c: AIConfig) => void,
  message: ReturnType<typeof AntdApp.useApp>['message'],
): SettingsEditor {
  const [text, setText] = useState(() => stringifyConfig(config));
  const [draft, setDraft] = useState<AIConfig>(config);
  const [promptDraft, setPromptDraft] = useState<PromptDraft>(() => ({
    agentInstructions: config.prompts?.agentInstructions ?? '',
    agentOpening: config.prompts?.agentOpening ?? INTERVIEW_AGENT_OPENING_INSTRUCTION,
  }));
  const [activeTab, setActiveTab] = useState('settings');

  // 仅在主动保存（config 变化）后把草稿同步回已保存值；切 tab 不触发，草稿得以保留。
  useEffect(() => {
    setDraft(config);
    setText(stringifyConfig(config));
    setPromptDraft({
      agentInstructions: config.prompts?.agentInstructions ?? '',
      agentOpening: config.prompts?.agentOpening ?? INTERVIEW_AGENT_OPENING_INSTRUCTION,
    });
  }, [config]);

  const updateProvider = (index: number, patch: Partial<AIConfig['providers'][number]>) => {
    setDraft((current) => ({
      ...current,
      providers: current.providers.map((provider, i) => (i === index ? { ...provider, ...patch } : provider)),
    }));
  };

  const moveProvider = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.providers.length) return;
    setDraft((current) => {
      const providers = [...current.providers];
      [providers[index], providers[target]] = [providers[target], providers[index]];
      return { ...current, providers };
    });
  };

  const updateProficiency = (key: keyof AIConfig['proficiency'], value: number | null) => {
    setDraft((current) => ({
      ...current,
      proficiency: { ...current.proficiency, [key]: value ?? current.proficiency[key] },
    }));
  };

  const handleSave = () => {
    const res = parseConfigJSON(text);
    if (!res.ok) {
      message.error(res.error);
      return;
    }
    onSave(res.config);
    setDraft(res.config);
  };

  const handleFormSave = () => {
    const next = { ...draft, masteryThreshold: draft.masteryThreshold ?? 75, proficiency: draft.proficiency };
    setDraft(next);
    setText(stringifyConfig(next));
    onSave(next);
    message.success('设置已保存');
  };

  const handlePromptSave = () => {
    const prompts = {
      agentInstructions: promptDraft.agentInstructions.trim() || undefined,
      agentOpening: promptDraft.agentOpening.trim() || undefined,
    };
    const next = { ...draft, prompts };
    setDraft(next);
    setText(stringifyConfig(next));
    onSave(next);
    message.success('提示词已保存');
  };

  return {
    draft,
    setDraft,
    text,
    setText,
    promptDraft,
    setPromptDraft,
    activeTab,
    setActiveTab,
    updateProvider,
    moveProvider,
    updateProficiency,
    handleFormSave,
    handlePromptSave,
    handleSave,
  };
}
