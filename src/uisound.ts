// Menu click sounds, played 2D to the clicking player.
import { Sounds } from "bf6-portal-utils/sounds";

import { CONFIG } from "./config";

export const UI_SOUND = {
    click: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_PrimarySelect_OneShot2D,
    tab: mod.RuntimeSpawn_Common.SFX_UI_EOR_NavigationTab_OneShot2D,
    step: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_SlidersClickDown_OneShot2D,
    on: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_ToggleOn_OneShot2D,
    off: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_ToggleOff_OneShot2D,
    open: mod.RuntimeSpawn_Common.SFX_UI_Submenu_Open_2D,
    close: mod.RuntimeSpawn_Common.SFX_UI_Submenu_Close_2D,
} as const;

export function playUiSound(player: mod.Player, asset: mod.RuntimeSpawn_Common): void {
    Sounds.playOneShot(asset, CONFIG.uiSoundMs, CONFIG.uiSoundAmp, { target: player });
}

const STEPPER = /^(btn(Amp|Rng|Scale)(Up|Down)|mtP\d(Up|Down)|mtVol(Up|Down))$/;

/** Click sound for an action. PLAY and favourite toggles handle their own sound. */
export function clickSound(action: string): mod.RuntimeSpawn_Common | undefined {
    if (action === "mtPlay" || action === "mtSave" || /^r\d+_(play|fav)$/.test(action)) return undefined;
    if (action === "btnClose") return UI_SOUND.close;
    if (action.slice(0, 3) === "tab") return UI_SOUND.tab;
    if (STEPPER.test(action)) return UI_SOUND.step;
    return UI_SOUND.click;
}
