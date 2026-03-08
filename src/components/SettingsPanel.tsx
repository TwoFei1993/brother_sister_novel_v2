import React from 'react';
import { NovelSettings, defaultSettings, GenreType, BrotherPersonality, SisterPersonality, RelationType, StoryTone, LengthType, WritingStyle } from '@/types/novel';
import { genres, brotherPersonalities, sisterPersonalities, relationTypes, storyTones, lengthOptions, writingStyles } from '@/data/genres';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, Play, ChevronLeft } from 'lucide-react';

interface SettingsPanelProps {
  settings: NovelSettings;
  onChange: (settings: NovelSettings) => void;
  onGenerate: () => void;
  onRandomize: () => void;
  isGenerating: boolean;
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({ settings, onChange, onGenerate, onRandomize, isGenerating, isOpen, onClose }: SettingsPanelProps) {
  const currentGenre = genres.find(g => g.id === settings.genre) || genres[0];

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
                <Label className="text-xs">故事基调</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {storyTones.map(t => (
                    <button
                      key={t}
                      onClick={() => update('storyTone', t)}
                      className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                        settings.storyTone === t
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <Input
                  value={settings.customStoryTone}
                  onChange={e => update('customStoryTone', e.target.value)}
                  placeholder="自定义基调，如：黑色幽默、悬疑惊悚..."
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <Label className="text-xs">篇幅选择</Label>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  {lengthOptions.map(l => (
                    <button
                      key={l.id}
                      onClick={() => update('lengthType', l.id)}
                      className={`text-xs p-2 rounded-lg border text-left transition-colors ${
                        settings.lengthType === l.id
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="font-medium">{l.label}</div>
                      <div className="opacity-70">{l.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs">额外要求</Label>
                <Textarea
                  value={settings.extraRequirements}
                  onChange={e => update('extraRequirements', e.target.value)}
                  placeholder="自由补充任何细节..."
                  className="mt-1 text-xs h-14"
                />
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
    </div>
  );
}
