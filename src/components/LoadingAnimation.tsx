import React from 'react';
import { GenreType } from '@/types/novel';
import { getGenre } from '@/data/genres';

interface LoadingAnimationProps {
  genre: GenreType;
  text: string;
  isVisible: boolean;
}

export function LoadingAnimation({ genre, text, isVisible }: LoadingAnimationProps) {
  if (!isVisible) return null;

  const g = getGenre(genre);

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div className={`h-16 w-16 rounded-full border-2 border-primary flex items-center justify-center ${g.animClass}`}>
        <div className="h-8 w-8 rounded-full bg-primary/30 animate-pulse" />
      </div>
      <p className="text-sm text-muted-foreground font-heading animate-pulse">{text || g.loadingText}</p>
    </div>
  );
}
