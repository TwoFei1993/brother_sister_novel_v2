import React, { useState } from 'react';
import { toast } from 'sonner';
import { NovelSettings, defaultSettings, GenreType, BrotherPersonality, SisterPersonality, RelationType, StoryTone, WritingStyle } from '@/types/novel';
import { genres, brotherPersonalities, sisterPersonalities, relationTypes, storyTones, writingStyles } from '@/data/genres';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, Play, ChevronLeft, ClipboardPaste, Wand2, Check, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface SettingsPanelProps {
  settings: NovelSettings;
  onChange: (settings: NovelSettings) => void;
  onGenerate: () => void;
  onRandomize: () => void;
  isGenerating: boolean;
  isOpen: boolean;
  onClose: () => void;
}

function autoFillFromOutline(outline: string, current: NovelSettings): Partial<NovelSettings> {
  const updates: Partial<NovelSettings> = {};

  // Pre-process: normalize outline by inserting newlines before inline numbered items
  const normalizedOutline = outline
    .replace(/(?<=[^\n\s])(\s*(?:\d+[\.\、\)\）]|[（\(]\s*[一二三四五六七八九十\d]+\s*[）\)]|[一二三四五六七八九十]+[\.\、：:])\s)/g, '\n$1')
    .replace(/(?<=[^\n\s])(\s*[\-\—\–─━]\s+(?:[\u4e00-\u9fff]))/g, '\n$1');

  // Section boundary: next heading / numbered item / bullet / double newline
  const SECTION_END = String.raw`(?:\n\n|\n(?=\s*[#＃●★☆►▶◆■□▪▸·•※]|\s*\d+[\.\、\)\）]\s|\s*[\-\—\–─━]\s|\s*[（\(]\s*[一二三四五六七八九十\d]+\s*[）\)]|\s*[一二三四五六七八九十]+[\.\、：:]\s)|$)`;

  // Helper: find content after a keyword, grab text until next section
  const extract = (patterns: (string | RegExp)[], src?: string): string | null => {
    const text = src ?? normalizedOutline;
    for (const pat of patterns) {
      const regex = typeof pat === 'string' ? new RegExp(pat, 'i') : pat;
      const m = text.match(regex);
      if (m && m[1] && m[1].trim().length >= 3) return m[1].trim();
    }
    return null;
  };

  // Multi-section extractor: collect content from repeated patterns (e.g., multiple 世界主线 entries)
  const extractAll = (pattern: RegExp, src?: string): string[] => {
    const text = src ?? normalizedOutline;
    const results: string[] = [];
    let m;
    const re = new RegExp(pattern.source, 'gi');
    while ((m = re.exec(text)) !== null) {
      if (m[1] && m[1].trim().length >= 3) results.push(m[1].trim());
    }
    return results;
  };

  // Background - try specific "背景" first, then fall back to "世界主线" aggregate
  const bg = extract([
    String.raw`(?:故事背景|时代背景|背景说明|背景介绍|世界观设定)[：:、，,]?\s*([\s\S]{3,500}?)` + SECTION_END,
    String.raw`(?:^|\n)\s*(?:背景|世界观)[：:、，,]\s*([\s\S]{3,500}?)` + SECTION_END,
  ]);
  if (bg) {
    updates.backgroundNote = bg.slice(0, 300);
  } else {
    // Try aggregating "世界主线" entries from volume descriptions
    const worldLines = extractAll(/世界主线[：:]\s*(.{3,200}?)(?:\n|$)/);
    if (worldLines.length > 0) {
      updates.backgroundNote = worldLines.join('；').slice(0, 300);
    }
  }

  // Brother abilities
  const bAbility = extract([
    new RegExp(String.raw`(?:哥哥|兄长|男主|兄|哥).{0,20}?(?:能力|金手指|天赋|技能|异能|特殊能力|实力|修为)[：:、，,]?\s*(.{3,200}?)` + SECTION_END, 'i'),
    new RegExp(String.raw`(?:能力|金手指|天赋|技能|异能).{0,10}?(?:哥哥|兄长|男主|兄|哥)[：:、，,]?\s*(.{3,200}?)` + SECTION_END, 'i'),
  ]);
  if (bAbility) updates.brotherAbility = bAbility;

  // Sister abilities
  const sAbility = extract([
    new RegExp(String.raw`(?:妹妹|妹|女主|女二).{0,20}?(?:能力|金手指|天赋|技能|异能|特殊能力|实力|修为)[：:、，,]?\s*(.{3,200}?)` + SECTION_END, 'i'),
    new RegExp(String.raw`(?:能力|金手指|天赋|技能|异能).{0,10}?(?:妹妹|妹|女主)[：:、，,]?\s*(.{3,200}?)` + SECTION_END, 'i'),
  ]);
  if (sAbility) updates.sisterAbility = sAbility;

  // Power system - exclude "惩罚体系" false matches, require actual cultivation/power terms
  const power = extract([
    new RegExp(String.raw`(?:修炼|力量|修行|修仙|武道|功法|灵气|斗气|魔法|超能力)(?:的)?(?:体系|系统|等级|境界|划分)[：:、，,]?\s*(.{3,300}?)` + SECTION_END, 'i'),
    new RegExp(String.raw`(?:境界|等级|修为)\s*(?:体系|系统|划分)[：:、，,]?\s*(.{3,300}?)` + SECTION_END, 'i'),
  ]);
  if (power) updates.powerSystem = power.slice(0, 300);

  // Factions - exclude "宗门小比" etc. short phrases; require standalone faction context
  const faction = extract([
    new RegExp(String.raw`(?:势力分布|势力格局|阵营分布|主要势力|派系|门派分布)[：:、，,]?\s*(.{3,300}?)` + SECTION_END, 'i'),
    new RegExp(String.raw`(?:势力|阵营|组织|家族|帝国)[：:、，,]\s*(.{3,300}?)` + SECTION_END, 'i'),
  ]);
  if (faction) updates.factions = faction.slice(0, 300);

  // Core conflict - be strict: require explicit "矛盾/冲突" terms, exclude "主线" alone to avoid false matches
  const conflict = extract([
    new RegExp(String.raw`(?:核心矛盾|主线冲突|核心冲突|主要矛盾|中心冲突)[：:、，,]?\s*(.{3,300}?)` + SECTION_END, 'i'),
    new RegExp(String.raw`(?:主线剧情)[：:、，,]\s*(.{3,300}?)` + SECTION_END, 'i'),
  ]);
  if (conflict) updates.coreConflict = conflict.slice(0, 300);

  // Try to extract chapter count from text like "230章" or "1～230 章"
  const chapterMatch = normalizedOutline.match(/(\d{2,3})\s*章/g);
  if (chapterMatch) {
    const nums = chapterMatch.map(m => parseInt(m));
    const maxChapter = Math.max(...nums);
    if (maxChapter >= 3 && maxChapter <= 50) {
      updates.desiredChapterCount = maxChapter;
    }
  }

  // Fallback: put whole outline as background
  if (Object.keys(updates).length === 0) {
    updates.backgroundNote = outline.slice(0, 500);
  }

  return updates;
}

export function SettingsPanel({ settings, onChange, onGenerate, onRandomize, isGenerating, isOpen, onClose }: SettingsPanelProps) {
  const currentGenre = genres.find(g => g.id === settings.genre) || genres[0];
  const [showAutoFillSuccess, setShowAutoFillSuccess] = useState(false);
  const [autoFillPreview, setAutoFillPreview] = useState<Partial<NovelSettings> | null>(null);
  const [showAutoFillPreview, setShowAutoFillPreview] = useState(false);

  const fieldLabels: Record<string, string> = {
    backgroundNote: '故事背景',
    brotherAbility: '哥哥金手指/能力',
    sisterAbility: '妹妹金手指/能力',
    powerSystem: '力量体系',
    factions: '势力/阵营',
    coreConflict: '核心矛盾/冲突',
    desiredChapterCount: '目标章数',
  };

  const update = <K extends keyof NovelSettings>(key: K, value: NovelSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const toggleBrotherPersonality = (p: BrotherPersonality) => {
    const current = settings.brotherPersonalities;
    if (current.includes(p)) {
      update('brotherPersonalities', current.filter(x => x !== p));
    } else if (current.length < 3) {
      update('brotherPersonalities', [...current, p]);
    }
  };

  const toggleSisterPersonality = (p: SisterPersonality) => {
    const current = settings.sisterPersonalities;
    if (current.includes(p)) {
      update('sisterPersonalities', current.filter(x => x !== p));
    } else if (current.length < 3) {
      update('sisterPersonalities', [...current, p]);
    }
  };

  const handleAutoFill = () => {
    if (!(settings.pastedOutline || '').trim()) return;
    const extracted = autoFillFromOutline(settings.pastedOutline || '', settings);
    if (Object.keys(extracted).length === 0) {
      toast.error('未能从文本中识别出任何设定项');
      return;
    }
    setAutoFillPreview(extracted);
    setShowAutoFillPreview(true);
  };

  const confirmAutoFill = () => {
    if (!autoFillPreview) return;
    onChange({ ...settings, ...autoFillPreview });
    const count = Object.keys(autoFillPreview).length;
    setShowAutoFillPreview(false);
    setAutoFillPreview(null);
    setShowAutoFillSuccess(true);
    toast.success(`已自动填入 ${count} 个设定项`);
    setTimeout(() => setShowAutoFillSuccess(false), 2000);
  };

  return (
    <div className={`fixed inset-y-0 left-0 z-40 w-[85vw] sm:w-80 bg-card border-r border-border transform transition-transform duration-300 flex flex-col ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0 lg:w-80 ${isOpen ? '' : 'lg:hidden'}`}>
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h2 className="font-heading text-lg font-bold">创作设定</h2>
        <Button variant="ghost" size="icon" onClick={onClose} className="lg:hidden">
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">

          {/* 粘贴大纲区域 */}
          <section className="border border-primary/30 rounded-lg p-3 bg-primary/5">
            <h3 className="text-sm font-semibold text-primary mb-2 flex items-center gap-1">
              <ClipboardPaste className="h-4 w-4" /> 粘贴你的大纲/架构
            </h3>
            <Textarea
              value={settings.pastedOutline}
              onChange={e => update('pastedOutline', e.target.value)}
              placeholder="在这里粘贴你已有的故事大纲、架构、设定文档等大段文字...&#10;&#10;系统会自动识别其中的背景、能力、势力等信息并填入下方对应区域。生成大纲时也会着重参考这里的内容。"
              className="mt-1 text-xs h-32 resize-y"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleAutoFill}
              disabled={!(settings.pastedOutline || '').trim()}
              className="w-full mt-2 gap-1 text-xs"
            >
              <Wand2 className="h-3 w-3" />
              {showAutoFillSuccess ? '✅ 已填入！' : '一键填入下方设定'}
            </Button>
          </section>

          <Separator />

          {/* 基础设定 */}
          <section>
            <h3 className="text-sm font-semibold text-primary mb-3">📚 基础设定</h3>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">题材类型</Label>
                <Select value={settings.genre} onValueChange={(v: GenreType) => {
                  const g = genres.find(x => x.id === v);
                  const newSubGenre = g && g.subGenres.length > 0 ? g.subGenres[0].id : '';
                  onChange({ ...settings, genre: v, subGenre: newSubGenre });
                }}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {genres.map(g => (
                      <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {settings.genre === 'custom' && (
                <div>
                  <Label className="text-xs">自定义题材名称</Label>
                  <Input
                    value={settings.customGenre}
                    onChange={e => update('customGenre', e.target.value)}
                    placeholder="例如：都市异能、校园推理、仙侠言情..."
                    className="mt-1 text-xs"
                  />
                </div>
              )}

              {currentGenre.subGenres.length > 0 && (
                <div>
                  <Label className="text-xs">子类型</Label>
                  <Select value={settings.subGenre} onValueChange={v => update('subGenre', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {currentGenre.subGenres.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                      ))}
                      <SelectItem value="__custom">✏️ 自定义</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(settings.subGenre === '__custom' || settings.genre === 'custom') && (
                <div>
                  <Label className="text-xs">自定义子类型</Label>
                  <Input
                    value={settings.customSubGenre}
                    onChange={e => update('customSubGenre', e.target.value)}
                    placeholder="输入自定义子类型..."
                    className="mt-1 text-xs"
                  />
                </div>
              )}

              <div>
                <Label className="text-xs">故事背景补充</Label>
                <Textarea
                  value={settings.backgroundNote}
                  onChange={e => update('backgroundNote', e.target.value)}
                  placeholder="自由描述额外世界观细节..."
                  className="mt-1 text-xs h-16"
                />
              </div>
            </div>
          </section>

          <Separator />

          {/* 文风选择 */}
          <section>
            <h3 className="text-sm font-semibold text-primary mb-3">✍️ 文风选择</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-1">
                {writingStyles.map(ws => (
                  <button
                    key={ws.id}
                    onClick={() => update('writingStyle', ws.id)}
                    className={`text-xs p-2 rounded-lg border text-left transition-colors ${
                      settings.writingStyle === ws.id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="font-medium">{ws.label}</div>
                    <div className="opacity-70">{ws.desc}</div>
                  </button>
                ))}
              </div>
              {settings.writingStyle === 'custom' && (
                <div>
                  <Label className="text-xs">描述你想要的文风</Label>
                  <Textarea
                    value={settings.customWritingStyle}
                    onChange={e => update('customWritingStyle', e.target.value)}
                    placeholder="例如：鲁迅式冷峻讽刺、古龙式短句飘逸、余华式平静叙述..."
                    className="mt-1 text-xs h-16"
                  />
                </div>
              )}
            </div>
          </section>

          <Separator />

          {/* 人物设定 */}
          <section>
            <h3 className="text-sm font-semibold text-primary mb-3">👥 人物设定</h3>

            {/* 哥哥 */}
            <div className="space-y-2 mb-4">
              <Label className="text-xs font-semibold">哥哥</Label>
              <div>
                <Label className="text-xs text-muted-foreground">年龄: {settings.brotherAge}岁</Label>
                <Slider
                  value={[settings.brotherAge]}
                  onValueChange={v => update('brotherAge', v[0])}
                  min={18} max={35} step={1}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">性格（最多3个，可自定义）</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {brotherPersonalities.map(p => (
                    <button
                      key={p}
                      onClick={() => toggleBrotherPersonality(p)}
                      className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                        settings.brotherPersonalities.includes(p)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <Input
                  value={settings.customBrotherPersonality}
                  onChange={e => update('customBrotherPersonality', e.target.value)}
                  placeholder="自定义性格，如：毒舌傲娇、外冷内热..."
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">金手指/能力</Label>
                <Textarea
                  value={settings.brotherAbility}
                  onChange={e => update('brotherAbility', e.target.value)}
                  placeholder="系统加持 / 前世记忆 / 神级天赋..."
                  className="mt-1 text-xs h-12"
                />
              </div>
            </div>

            {/* 妹妹 */}
            <div className="space-y-2 mb-4">
              <Label className="text-xs font-semibold">妹妹</Label>
              <div>
                <Label className="text-xs text-muted-foreground">年龄: {settings.sisterAge}岁</Label>
                <Slider
                  value={[settings.sisterAge]}
                  onValueChange={v => update('sisterAge', v[0])}
                  min={16} max={30} step={1}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">性格（最多3个，可自定义）</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {sisterPersonalities.map(p => (
                    <button
                      key={p}
                      onClick={() => toggleSisterPersonality(p)}
                      className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                        settings.sisterPersonalities.includes(p)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <Input
                  value={settings.customSisterPersonality}
                  onChange={e => update('customSisterPersonality', e.target.value)}
                  placeholder="自定义性格，如：腹黑女王、治愈系..."
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">金手指/能力</Label>
                <Textarea
                  value={settings.sisterAbility}
                  onChange={e => update('sisterAbility', e.target.value)}
                  placeholder="异能觉醒 / 空间能力 / 医术天才..."
                  className="mt-1 text-xs h-12"
                />
              </div>
            </div>

            {/* 兄妹关系 */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">兄妹关系模式</Label>
              <Select value={settings.relationType} onValueChange={(v: RelationType) => update('relationType', v)}>
                <SelectTrigger className="mt-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {relationTypes.map(r => (
                    <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={settings.customRelationType}
                onChange={e => update('customRelationType', e.target.value)}
                placeholder="自定义关系模式，如：青梅竹马型..."
                className="text-xs"
              />
            </div>
          </section>

          <Separator />

          {/* 世界观设定 */}
          <section>
            <h3 className="text-sm font-semibold text-primary mb-3">🌍 世界观设定</h3>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">能力/修炼体系</Label>
                <Textarea
                  value={settings.powerSystem}
                  onChange={e => update('powerSystem', e.target.value)}
                  placeholder="境界划分、异能等级、积分体系..."
                  className="mt-1 text-xs h-14"
                />
              </div>
              <div>
                <Label className="text-xs">主要势力</Label>
                <Textarea
                  value={settings.factions}
                  onChange={e => update('factions', e.target.value)}
                  placeholder="世界中的主要派系阵营..."
                  className="mt-1 text-xs h-14"
                />
              </div>
              <div>
                <Label className="text-xs">核心矛盾</Label>
                <Textarea
                  value={settings.coreConflict}
                  onChange={e => update('coreConflict', e.target.value)}
                  placeholder="故事最大的冲突或谜题..."
                  className="mt-1 text-xs h-14"
                />
              </div>
            </div>
          </section>

          <Separator />

          {/* 剧情设定 */}
          <section>
            <h3 className="text-sm font-semibold text-primary mb-3">📖 剧情设定</h3>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">故事基调（可多选）</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {storyTones.map(t => {
                    const isSelected = settings.storyTones.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() => {
                          const newTones = isSelected
                            ? settings.storyTones.filter(tone => tone !== t)
                            : [...settings.storyTones, t];
                          update('storyTones', newTones);
                        }}
                        className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                          isSelected
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 inline mr-1" />}
                        {t}
                      </button>
                    );
                  })}
                </div>
                <Input
                  value={settings.customStoryTone}
                  onChange={e => update('customStoryTone', e.target.value)}
                  placeholder="自定义基调，如：黑色幽默、悬疑惊悚..."
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <Label className="text-xs">期望生成章节数: {settings.desiredChapterCount} 章</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Slider
                    value={[settings.desiredChapterCount]}
                    onValueChange={v => update('desiredChapterCount', v[0])}
                    min={3} max={500} step={1}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={settings.desiredChapterCount}
                    onChange={e => {
                      const val = parseInt(e.target.value) || 3;
                      update('desiredChapterCount', Math.min(500, Math.max(3, val)));
                    }}
                    className="w-20 text-xs"
                    min={3}
                    max={500}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">生成细纲的章节数: {settings.outlineChapterCount} 章</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Slider
                    value={[settings.outlineChapterCount]}
                    onValueChange={v => update('outlineChapterCount', v[0])}
                    min={1} max={settings.desiredChapterCount} step={1}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={settings.outlineChapterCount}
                    onChange={e => {
                      const val = parseInt(e.target.value) || 1;
                      update('outlineChapterCount', Math.min(settings.desiredChapterCount, Math.max(1, val)));
                    }}
                    className="w-20 text-xs"
                    min={1}
                    max={settings.desiredChapterCount}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  只生成到第 {settings.outlineChapterCount} 章的详细大纲，后续章节保留整体节奏规划
                </p>
              </div>
            </div>
          </section>
        </div>
      </ScrollArea>

      {/* Bottom buttons */}
      <div className="p-4 border-t border-border space-y-2">
        <Button
          onClick={onGenerate}
          disabled={isGenerating}
          className="w-full gap-2 theme-glow font-heading text-base"
          size="lg"
        >
          <Play className="h-4 w-4" />
          {isGenerating ? '创作中...' : '开始创作'}
        </Button>
        <Button variant="outline" onClick={onRandomize} disabled={isGenerating} className="w-full gap-2 text-sm">
          <Sparkles className="h-3 w-3" />
          随机生成设定
        </Button>
      </div>

      {/* Auto-fill preview dialog */}
      <Dialog open={showAutoFillPreview} onOpenChange={setShowAutoFillPreview}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">📋 一键填入预览</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[50vh] overflow-y-auto">
            {autoFillPreview && Object.entries(autoFillPreview).map(([key, value]) => (
              <div key={key} className="border border-border rounded-md p-3 bg-muted/30">
                <div className="text-xs font-semibold text-primary mb-1">
                  {fieldLabels[key] || key}
                </div>
                <div className="text-xs text-foreground whitespace-pre-wrap break-words">
                  {String(value).slice(0, 200)}{String(value).length > 200 ? '...' : ''}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowAutoFillPreview(false)} className="gap-1">
              <X className="h-3 w-3" /> 取消
            </Button>
            <Button onClick={confirmAutoFill} className="gap-1">
              <Check className="h-3 w-3" /> 确认填入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
