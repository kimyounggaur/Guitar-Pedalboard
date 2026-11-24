import { useCallback, useEffect, useState } from 'react';
import { isEscapeOwnedByTarget } from '../components/GlobalKeyboardShortcuts';
import { safeStorage, STORAGE_KEYS } from '../persistence';
import { useMediaQuery } from './useMediaQuery';

/**
 * 데스크톱 오른쪽 오디오 패널(프리셋·미터·체인 글자)의 열림 상태(설계서 S1.8, 4.10절).
 *
 *   · 1280px 이상: 페달 보드 옆에 붙어 있다(붙박이). 기본은 열림이고, 접으면 그 선택을 `guitar-pedalboard:ui` 에 기억한다.
 *   · 768~1279px: 화면 위에 뜨는 서랍이다. 기본은 닫힘이고 버튼·Esc·바깥 클릭으로 여닫는다. 서랍은 화면을 덮으므로 열림을 저장하지 않는다.
 *
 * 두 상태를 따로 들고 있어서, 창 폭을 오가도 붙박이의 선택이 서랍 때문에 바뀌지 않는다.
 */
export const SIDEBAR_DOCK_MIN_WIDTH = 1280;
export const SIDEBAR_DOCK_QUERY = `(min-width: ${SIDEBAR_DOCK_MIN_WIDTH}px)`;

interface StoredUi {
  sidebarOpen?: boolean;
}

function isStoredUi(value: unknown): value is StoredUi {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const open = (value as { sidebarOpen?: unknown }).sidebarOpen;
  return open === undefined || typeof open === 'boolean';
}

function readStoredUi(): StoredUi {
  return safeStorage.get<StoredUi>(STORAGE_KEYS.ui, {}, isStoredUi);
}

export interface SidebarState {
  /** 붙박이(1280px 이상)면 true, 서랍이면 false */
  docked: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
}

export function useSidebar(): SidebarState {
  const docked = useMediaQuery(SIDEBAR_DOCK_QUERY);
  const [dockedOpen, setDockedOpen] = useState(() => readStoredUi().sidebarOpen ?? true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [previousDocked, setPreviousDocked] = useState(docked);

  // 폭이 바뀌어 서랍 모드로 돌아왔을 때 이전에 열어 두었던 서랍이 갑자기 화면을 덮지 않도록, 붙박이가 되는 순간 서랍을 닫아 둔다.
  if (previousDocked !== docked) {
    setPreviousDocked(docked);
    if (docked) setDrawerOpen(false);
  }

  const open = docked ? dockedOpen : drawerOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (docked) {
        setDockedOpen(next);
        safeStorage.set(STORAGE_KEYS.ui, { ...readStoredUi(), sidebarOpen: next });
      } else {
        setDrawerOpen(next);
      }
    },
    [docked],
  );

  // 서랍이 열려 있을 때 Esc 로 닫는다. 글자 칸·선택 상자·메뉴가 Esc 를 먼저 써야 하는 경우는 그쪽에 맡긴다.
  // 이 처리기는 이벤트를 막지 않으므로 연주 중 Esc 의 긴급 정지(E-01)는 그대로 함께 일어난다.
  useEffect(() => {
    if (docked || !drawerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || isEscapeOwnedByTarget(event.target)) return;
      setDrawerOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [docked, drawerOpen]);

  return { docked, open, setOpen };
}
