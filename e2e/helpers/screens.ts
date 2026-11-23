// 화면 프로필 10종(설계서 S0.4, 필요하면 1680×1050 추가). 앱의 모바일 배치 경계는 767 px 이하(AppShell MOBILE_LAYOUT_QUERY).
export interface ScreenProfile {
  /** 'WxH' */
  name: string;
  width: number;
  height: number;
  /** 폭 767 px 이하라 모바일 배치(하단 도크)로 그려지는 화면 */
  phone: boolean;
}

function profile(width: number, height: number): ScreenProfile {
  return { name: `${width}x${height}`, width, height, phone: width <= 767 };
}

export const SCREEN_PROFILES: readonly ScreenProfile[] = [
  profile(390, 844),
  profile(360, 640),
  profile(412, 915),
  profile(768, 1024),
  profile(1024, 768),
  profile(1280, 800),
  profile(1366, 768),
  profile(1440, 900),
  profile(1536, 864),
  profile(1920, 1080),
];

/** E-04 가 보는 휴대폰 화면 */
export const PHONE_PROFILES = SCREEN_PROFILES.filter((screen) => screen.phone);
/** E-06 이 보는 768 px 이상 화면 */
export const DESKTOP_PROFILES = SCREEN_PROFILES.filter((screen) => !screen.phone);
