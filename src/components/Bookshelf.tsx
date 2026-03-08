import React, { useState, useEffect, useMemo } from 'react';
import { NovelProject } from '@/types/novel';
import { Button } from '@/components/ui/button';
import { Trash2, BookOpen, PenLine, Plus, ArrowUpDown, Search, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface BookshelfProps {
  onOpenProject: (project: NovelProject) => void;
  onContinueProject: (project: NovelProject) => void;
  onNewProject: () => void;
}

const genreLabels: Record<string, string> = {
  chuanyue: '穿越重生', scifi: '星际科幻', moshi: '末世求生',
  wuxian: '无限流', xuanhuan: '玄幻修仙', hunhe: '混合类型',
};

const genreColors: Record<string, string> = {
  chuanyue: 'from-amber-800 to-yellow-900',
  scifi: 'from-cyan-800 to-blue-900',
  moshi: 'from-gray-700 to-red-900',
  wuxian: 'from-purple-800 to-indigo-900',
  xuanhuan: 'from-indigo-800 to-amber-900',
  hunhe: 'from-violet-800 to-teal-900',
};

const genreSpinePatterns: Record<string, string> = {
  chuanyue: '📜', scifi: '🚀', moshi: '☢️',
  wuxian: '♾️', xuanhuan: '⚔️', hunhe: '🌀',
};

type SortOption = 'newest' | 'oldest' | 'name' | 'chapters' | 'words' | 'genre';

const sortLabels: Record<SortOption, string> = {
  newest: '最近更新',
  oldest: '最早创建',
  name: '按名称',
  chapters: '按章节数',
  words: '按字数',
  genre: '按题材',
};

export function Bookshelf({ onOpenProject, onContinueProject, onNewProject }: BookshelfProps) {
  const [projects, setProjects] = useState<NovelProject[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('novel_history') || '[]');
    setProjects(saved);
  }, []);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = projects.filter(p => p.id !== id);
    localStorage.setItem('novel_history', JSON.stringify(updated));
    setProjects(updated);
  };

  const wordCount = (p: NovelProject) =>
    p.chapters.reduce((acc, c) => acc + c.content.length, 0);

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const q = searchQuery.trim().toLowerCase();
    return projects.filter(p => {
      const title = (p.title || '').toLowerCase();
      const genre = (genreLabels[p.settings.genre] || '').toLowerCase();
      return title.includes(q) || genre.includes(q);
    });
  }, [projects, searchQuery]);

  const sortedProjects = useMemo(() => {
    const sorted = [...filteredProjects];
    switch (sortBy) {
      case 'newest': return sorted.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
      case 'oldest': return sorted.sort((a, b) => a.createdAt - b.createdAt);
      case 'name': return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      case 'chapters': return sorted.sort((a, b) => b.chapters.length - a.chapters.length);
      case 'words': return sorted.sort((a, b) => wordCount(b) - wordCount(a));
      case 'genre': return sorted.sort((a, b) => a.settings.genre.localeCompare(b.settings.genre));
      default: return sorted;
    }
  }, [filteredProjects, sortBy]);

  return (
    <div className="flex-1 flex flex-col items-center p-3 sm:p-6 overflow-hidden">
      <div className="w-full max-w-5xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-8 gap-3">
          <div>
            <h2 className="text-2xl sm:text-3xl font-heading font-bold theme-glow-text">我的书架</h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">共 {projects.length} 本作品</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[120px] sm:flex-none">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="搜索书名或题材..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-8 h-9 w-full sm:w-52 text-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1 text-xs">
                  <ArrowUpDown className="h-3 w-3" />
                  <span className="hidden sm:inline">{sortLabels[sortBy]}</span>
                  <span className="sm:hidden">排序</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(Object.keys(sortLabels) as SortOption[]).map(key => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => setSortBy(key)}
                    className={sortBy === key ? 'bg-accent' : ''}
                  >
                    {sortLabels[key]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={onNewProject} className="gap-1 sm:gap-2 font-heading theme-glow text-xs sm:text-sm">
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">新建作品</span><span className="sm:hidden">新建</span>
            </Button>
          </div>
        </div>

        {sortedProjects.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">{searchQuery ? '🔍' : '📚'}</div>
            <p className="text-muted-foreground text-lg">
              {searchQuery ? `没有找到"${searchQuery}"相关的作品` : '书架空空如也'}
            </p>
            <p className="text-muted-foreground text-sm mt-1">
              {searchQuery ? '试试其他关键词' : '点击「新建作品」开始你的创作之旅'}
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-220px)] sm:h-[calc(100vh-200px)]">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-6">
              {sortedProjects.map(p => (
                <div key={p.id} className="group relative">
                  <button
                    onClick={() => onOpenProject(p)}
                    className={`w-full aspect-[2/3] rounded-lg bg-gradient-to-br ${genreColors[p.settings.genre] || 'from-gray-700 to-gray-900'}
                      shadow-lg hover:shadow-xl transition-all duration-300
                      group-hover:-translate-y-2 group-hover:rotate-1
                      flex flex-col items-center justify-between p-4 text-left relative overflow-hidden
                      border border-border/30`}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-black/30 to-transparent" />
                    <div className="text-3xl mt-2 opacity-30 absolute top-2 right-2">
                      {genreSpinePatterns[p.settings.genre]}
                    </div>
                    <div className="flex-1 flex items-center justify-center w-full">
                      <h3 className="text-sm font-heading font-bold text-center leading-tight line-clamp-3 text-white/90 drop-shadow-md">
                        {p.title || '未命名'}
                      </h3>
                    </div>
                    <div className="w-full text-center space-y-1">
                      <div className="text-[10px] text-white/50">
                        {genreLabels[p.settings.genre]}
                      </div>
                      <div className="text-[10px] text-white/40">
                        {p.chapters.length}章 · {(wordCount(p) / 1000).toFixed(1)}k字
                      </div>
                    </div>
                    <div className="absolute -bottom-2 left-1 right-1 h-4 bg-black/20 blur-md rounded-full" />
                  </button>

                  <div className="absolute -bottom-1 left-0 right-0 flex justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="secondary" size="icon" className="h-7 w-7 shadow-md"
                      onClick={() => onContinueProject(p)} title="续写">
                      <PenLine className="h-3 w-3" />
                    </Button>
                    <Button variant="secondary" size="icon" className="h-7 w-7 shadow-md"
                      onClick={() => onOpenProject(p)} title="阅读">
                      <BookOpen className="h-3 w-3" />
                    </Button>
                    <Button variant="destructive" size="icon" className="h-7 w-7 shadow-md"
                      onClick={(e) => handleDelete(e, p.id)} title="删除">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  <p className="text-[10px] text-muted-foreground text-center mt-3">
                    {new Date(p.updatedAt || p.createdAt).toLocaleDateString('zh-CN')}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4 h-3 bg-gradient-to-b from-muted/50 to-transparent rounded-full" />
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
