import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff, Plus, X, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface ApiSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PRESET_MODELS = [
  { value: 'gpt-4o', label: 'gpt-4o（OpenAI）' },
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini（OpenAI）' },
  { value: 'qwen-max', label: 'qwen-max（通义千问）' },
  { value: 'qwen-plus', label: 'qwen-plus（通义千问）' },
  { value: 'deepseek-chat', label: 'deepseek-chat（DeepSeek）' },
];

const PRESET_BASES: { label: string; url: string }[] = [
  { label: 'OpenAI 官方', url: 'https://api.openai.com/v1' },
  { label: '通义千问（阿里云）', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { label: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
];

export function ApiSettingsDialog({ open, onOpenChange }: ApiSettingsDialogProps) {
  const [apiKey, setApiKey] = useState(localStorage.getItem('llm_api_key') || '');
  const [model, setModel] = useState(localStorage.getItem('llm_model') || 'gpt-4o');
  const [baseUrl, setBaseUrl] = useState(localStorage.getItem('llm_base_url') || 'https://api.openai.com/v1');
  const [showKey, setShowKey] = useState(false);

  const [customModels, setCustomModels] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('custom_models') || '[]'); } catch { return []; }
  });
  const [newModelName, setNewModelName] = useState('');
  const [showAddModel, setShowAddModel] = useState(false);

  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const allModels = [
    ...PRESET_MODELS,
    ...customModels.map(m => ({ value: m, label: m })),
  ];

  const handleAddModel = () => {
    const name = newModelName.trim();
    if (name && !allModels.find(m => m.value === name)) {
      const updated = [...customModels, name];
      setCustomModels(updated);
      localStorage.setItem('custom_models', JSON.stringify(updated));
      setModel(name);
      setNewModelName('');
      setShowAddModel(false);
    }
  };

  const handleRemoveModel = (m: string) => {
    const updated = customModels.filter(x => x !== m);
    setCustomModels(updated);
    localStorage.setItem('custom_models', JSON.stringify(updated));
    if (model === m) setModel('gpt-4o');
  };

  const handleTest = async () => {
    if (!apiKey.trim()) { setTestStatus('error'); setTestMessage('请先输入 API Key'); return; }
    setTestStatus('loading');
    setTestMessage('');
    try {
      const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: '请回复"连接成功"四个字' }],
          max_tokens: 20,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content || '(空回复)';
      setTestStatus('success');
      setTestMessage(`模型回复：${reply}`);
    } catch (err: any) {
      setTestStatus('error');
      setTestMessage(err.message || '连接失败');
    }
  };

  const handleSave = () => {
    localStorage.setItem('llm_api_key', apiKey);
    localStorage.setItem('llm_model', model);
    localStorage.setItem('llm_base_url', baseUrl.replace(/\/+$/, ''));
    // Migrate old keys
    localStorage.setItem('openai_api_key', apiKey);
    localStorage.setItem('openai_model', model);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg">大模型 API 设置</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {/* Base URL */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">API 地址（Base URL）</Label>
            <Input
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap gap-1.5">
              {PRESET_BASES.map(p => (
                <button
                  key={p.url}
                  type="button"
                  onClick={() => setBaseUrl(p.url)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    baseUrl === p.url
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">API Key</Label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-... 或 dashscope key"
                className="pr-10 font-mono text-xs"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Model */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">模型选择</Label>
              <button
                type="button"
                onClick={() => setShowAddModel(!showAddModel)}
                className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
              >
                <Plus className="h-3 w-3" />
                自定义模型
              </button>
            </div>

            {showAddModel && (
              <div className="flex gap-2">
                <Input
                  value={newModelName}
                  onChange={e => setNewModelName(e.target.value)}
                  placeholder="输入模型名称，如 qwen3-max"
                  className="text-sm"
                  onKeyDown={e => e.key === 'Enter' && handleAddModel()}
                />
                <Button size="sm" onClick={handleAddModel} disabled={!newModelName.trim()}>
                  添加
                </Button>
              </div>
            )}

            {/* Model chips */}
            <div className="flex flex-wrap gap-1.5">
              {allModels.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setModel(m.value)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1 ${
                    model === m.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                  }`}
                >
                  {m.label}
                  {customModels.includes(m.value) && (
                    <span
                      onClick={e => { e.stopPropagation(); handleRemoveModel(m.value); }}
                      className="hover:text-destructive ml-0.5 cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Test */}
          <div className="space-y-2">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testStatus === 'loading'}
              className="w-full"
            >
              {testStatus === 'loading' ? (
                <><Loader2 className="h-4 w-4 animate-spin" />测试连接中...</>
              ) : '🔌 测试连接'}
            </Button>
            {testStatus === 'success' && (
              <div className="flex items-start gap-2 text-sm text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400 p-2.5 rounded-md">
                <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{testMessage}</span>
              </div>
            )}
            {testStatus === 'error' && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-2.5 rounded-md">
                <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{testMessage}</span>
              </div>
            )}
          </div>

          <Button onClick={handleSave} className="w-full">保存设置</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
