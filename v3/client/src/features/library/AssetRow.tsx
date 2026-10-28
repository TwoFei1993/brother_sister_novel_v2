/**
 * 资产行（自 AssetPanel 拆出，2026-10-27 走查条目④）
 *
 * - 头像：角色卡显示内嵌 avatar（PNG 底图 / data URL），无头像或非角色类型显示首字方块
 * - 操作收纳：主操作「编辑」常驻；复制到书/复制/重命名/导出/删除收进「⋯」菜单
 *   （此前 6 个等权重按钮常驻，30 行 × 6 按钮 = 180 个同权重框，扫视噪音大；功能一项不删）
 * - 删除保持 danger 色与 confirm 二次确认（confirm 在 AssetPanel.onDelete 内）
 */
import { useEffect, useRef, useState } from 'react';
import { BookCopy, Copy, MoreHorizontal, Pencil, Trash2, Upload } from 'lucide-react';

import type { AssetType, LibraryAssetRef } from '../../api/library';

interface AssetRowProps {
  type: AssetType;
  it: LibraryAssetRef;
  summary: string;
  avatar?: string;
  onEdit: (id: string) => void;
  onCopyToBook: (id: string, name: string) => void;
  onDuplicate: (id: string, name: string) => void;
  onRename: (id: string, name: string) => void;
  onExport: (id: string, name: string, format?: 'png' | 'json') => void;
  onDelete: (id: string, name: string) => void;
}

const menuItemCls =
  'flex min-h-[36px] w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[hsl(var(--fg))] transition-colors hover:bg-[hsl(var(--surface))]';

export default function AssetRow({
  type,
  it,
  summary,
  avatar,
  onEdit,
  onCopyToBook,
  onDuplicate,
  onRename,
  onExport,
  onDelete,
}: AssetRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  /** 头像加载失败回退首字方块（旧数据可能登记了已丢失的 PNG 路径） */
  const [avatarBroken, setAvatarBroken] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击行外任意处关闭菜单（mousedown 先于 click，避免菜单项点击被吞）
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const initial = it.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <li className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2">
      <div className="flex items-center gap-3">
        {/* 头像/首字方块 */}
        {type === 'characters' && avatar && !avatarBroken ? (
          <img
            src={avatar}
            alt=""
            aria-hidden
            onError={() => setAvatarBroken(true)}
            className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-[hsl(var(--border-soft))]"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))]/50 font-heading text-base text-[hsl(var(--fg-muted))]"
          >
            {initial}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[hsl(var(--fg))]">{it.name}</p>
          <p className="truncate text-xs text-[hsl(var(--fg-muted))]">
            {summary}
            {typeof it.createdAt === 'number' && it.createdAt > 0 && (
              <span className="ml-2 whitespace-nowrap">
                · 添加于 {new Date(it.createdAt).toLocaleDateString('zh-CN')}
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onEdit(it.id)}
          className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          编辑
        </button>

        {/* 次级操作菜单 */}
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            aria-label={`「${it.name}」更多操作`}
            aria-expanded={menuOpen}
            data-testid={`asset-more-${it.id}`}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[hsl(var(--fg-muted))] transition-colors hover:bg-[hsl(var(--muted))]/40 hover:text-[hsl(var(--fg))]"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-10 z-30 w-44 overflow-hidden rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] py-1 shadow-lg"
            >
              {(type === 'characters' || type === 'worldbooks') && (
                <button role="menuitem" type="button" data-testid="asset-copy-to-book" className={menuItemCls} onClick={() => { setMenuOpen(false); onCopyToBook(it.id, it.name); }}>
                  <BookCopy className="h-4 w-4 text-[hsl(var(--fg-muted))]" aria-hidden />
                  复制到书
                </button>
              )}
              {type === 'presets' && (
                <button role="menuitem" type="button" data-testid="asset-copy" className={menuItemCls} onClick={() => { setMenuOpen(false); onDuplicate(it.id, it.name); }}>
                  <Copy className="h-4 w-4 text-[hsl(var(--fg-muted))]" aria-hidden />
                  复制
                </button>
              )}
              <button role="menuitem" type="button" data-testid="asset-rename" className={menuItemCls} onClick={() => { setMenuOpen(false); onRename(it.id, it.name); }}>
                <Pencil className="h-4 w-4 text-[hsl(var(--fg-muted))]" aria-hidden />
                重命名
              </button>
              {type === 'characters' && (
                <button role="menuitem" type="button" className={menuItemCls} onClick={() => { setMenuOpen(false); onExport(it.id, it.name, 'png'); }}>
                  <Upload className="h-4 w-4 text-[hsl(var(--fg-muted))]" aria-hidden />
                  导出 PNG
                </button>
              )}
              <button role="menuitem" type="button" className={menuItemCls} onClick={() => { setMenuOpen(false); onExport(it.id, it.name, 'json'); }}>
                <Upload className="h-4 w-4 text-[hsl(var(--fg-muted))]" aria-hidden />
                导出 JSON
              </button>
              <button role="menuitem" type="button" className={`${menuItemCls} text-[hsl(var(--danger))] hover:bg-[hsl(var(--danger))]/10`} onClick={() => { setMenuOpen(false); onDelete(it.id, it.name); }}>
                <Trash2 className="h-4 w-4" aria-hidden />
                删除
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
