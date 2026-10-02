// --- BUNDLED TYPESCRIPT OUTPUT ---
// @ts-nocheck
// --- SOURCE: node_modules\bf6-portal-utils\logging\index.ts ---
export class Logging {
private static _safeErrorToString(error: unknown): string {
try {
if (error instanceof Error) {
try {
return error.message || 'Error';
} catch {
return 'Error (message unavailable)';
}
}
try {
return String(error);
} catch {
return '[Error object]';
}
} catch {
return '[Unable to stringify error]';
}
}
public constructor(tag: string) {
this._tag = tag;
}
private _tag: string;
private _logLevel: Logging.LogLevel = Logging.LogLevel.Info;
private _includeRawError: boolean = false;
private _logger?: (text: string, error?: unknown) => Promise<void> | void;
private readonly _asyncErrorHandler = (loggingError: unknown): void => {
console.log(`<${this._tag}> Error in async logger:`, loggingError);
};
public willLog(logLevel: Logging.LogLevel): boolean {
return this._logger != null && logLevel >= this._logLevel;
}
public log(text: string, logLevel: Logging.LogLevel = Logging.LogLevel.Warning, error?: unknown): void {
if (!this._logger || logLevel < this._logLevel) return;
try {
const errorText = this._includeRawError && error ? ` - Error: ${Logging._safeErrorToString(error)}` : '';
const result = this._logger(`<${this._tag}> ${text}${errorText}`, error);
if (result instanceof Promise) {
result.catch(this._asyncErrorHandler);
}
} catch (logError: unknown) {
console.log(`<${this._tag}> Error in sync logger:`, logError);
}
}
public setLogging(
log?: (text: string, error?: unknown) => Promise<void> | void,
logLevel?: Logging.LogLevel,
includeRawError?: boolean
): void {
this._logger = log;
this._logLevel = logLevel ?? Logging.LogLevel.Warning;
this._includeRawError = includeRawError ?? false;
}
}
export namespace Logging {
export enum LogLevel {
Debug = 0,
Info = 1,
Warning = 2,
Error = 3,
}
}
// --- SOURCE: node_modules\bf6-portal-utils\callback-handler\index.ts ---
export namespace CallbackHandler {
function getCallbackNamePart(callback: ((...args: any[]) => unknown) | null | undefined): string {
const callbackName = callback?.name;
return !callbackName ? 'anonymous callback' : `${callbackName} callback`;
}
function getContextPart(context?: string): string {
return !context ? '' : `${context} `;
}
export function invokeNoArgs(
callback: (() => Promise<void> | void) | null | undefined,
logging: Logging,
context?: string
): void {
invoke(callback, undefined, undefined, undefined, undefined, logging, context);
}
export function invoke<T extends (...args: any[]) => Promise<void> | void>(
callback: T | null | undefined,
a: unknown,
b: unknown,
c: unknown,
d: unknown,
logging: Logging,
context?: string
): void {
if (!callback) return;
try {
const result = (callback as (a: unknown, b: unknown, c: unknown, d: unknown) => Promise<void> | void)(
a,
b,
c,
d
);
if (result instanceof Promise) {
result.catch((error: unknown) => {
logging.log(
`Error in ${getContextPart(context)}async ${getCallbackNamePart(callback)}:`,
Logging.LogLevel.Error,
error
);
});
}
} catch (error: unknown) {
logging.log(
`Error in ${getContextPart(context)}sync ${getCallbackNamePart(callback)}:`,
Logging.LogLevel.Error,
error
);
}
}
}
// --- SOURCE: node_modules\bf6-portal-utils\timers\index.ts ---
export namespace Timers {
const logging = new Logging('Timers');
export const LogLevel = Logging.LogLevel;
export function setLogging(
log?: (text: string, error?: unknown) => Promise<void> | void,
logLevel?: Logging.LogLevel,
includeRawError?: boolean
): void {
logging.setLogging(log, logLevel, includeRawError);
}
export type TimerID = number & { readonly __brand: 'TimerID' };
export const MAX_TIMER_DELAY_MS = 2_147_483_647;
// --- Configuration ---
const MAX_TIMERS = 512;
const MAX_GENERATIONS = 65_535;
const SERVER_START_TIME = Date.now();
const GENERATION_MULTIPLIER = 10_000;
const INVALID_INDEX = -1;
// --- Data-Oriented Storage (Zero Allocation Pool) ---
const _expirationTimes = new Uint32Array(MAX_TIMERS);
const _generations = new Uint16Array(MAX_TIMERS);
const _intervalMs = new Int32Array(MAX_TIMERS);
for (let i = 0; i < MAX_TIMERS - 1; ++i) {
_intervalMs[i] = i + 1;
}
_intervalMs[MAX_TIMERS - 1] = INVALID_INDEX;
let _firstFree = 0;
const _callbacks = new Array<(() => Promise<void> | void) | null>(MAX_TIMERS).fill(null);
let _activeTimerCount = 0;
let _isSubscribed = false;
function getUptime(): number {
return Date.now() - SERVER_START_TIME;
}
function _allocateSlot(): number {
if (_firstFree === INVALID_INDEX) {
logging.log('Pool is full', LogLevel.Error);
return INVALID_INDEX;
}
const index = _firstFree;
_firstFree = _intervalMs[index];
_intervalMs[index] = 0;
return index;
}
function _resolveIndex(id: TimerID): number {
if (id < 0) return INVALID_INDEX;
const index = id % GENERATION_MULTIPLIER;
if (index >= MAX_TIMERS) return INVALID_INDEX;
const expectedGen = Math.floor(id / GENERATION_MULTIPLIER);
if (_generations[index] !== expectedGen || _callbacks[index] === null) return INVALID_INDEX;
return index;
}
function _deleteTimer(index: number): void {
_callbacks[index] = null;
--_activeTimerCount;
if (_generations[index] < MAX_GENERATIONS) {
++_generations[index];
_intervalMs[index] = _firstFree;
_firstFree = index;
} else if (logging.willLog(LogLevel.Warning)) {
logging.log(`Slot ${index} exhausted max generations and was retired`, LogLevel.Warning);
}
}
function _handleTick(): void {
if (_activeTimerCount === 0) return;
const currentUptime = getUptime();
for (let index = 0; index < MAX_TIMERS; ++index) {
const cb = _callbacks[index];
if (cb === null) continue;
if (currentUptime < _expirationTimes[index]) continue;
if (_intervalMs[index] > 0) {
_expirationTimes[index] = currentUptime + _intervalMs[index];
} else {
_deleteTimer(index);
}
CallbackHandler.invokeNoArgs(cb, logging, 'trigger');
}
}
function _ensureSubscribed(): void {
if (_isSubscribed) return;
_isSubscribed = true;
Events.OnTickStart.subscribe(_handleTick);
}
function _createTimer(
callback: () => Promise<void> | void,
expirationDelay: number,
interval: number
): TimerID | null {
_ensureSubscribed();
const index = _allocateSlot();
if (index === INVALID_INDEX) return null;
++_activeTimerCount;
_callbacks[index] = callback;
_expirationTimes[index] = getUptime() + expirationDelay;
_intervalMs[index] = interval;
return (index + GENERATION_MULTIPLIER * _generations[index]) as TimerID;
}
export function setTimeout(callback: () => Promise<void> | void, ms: number): TimerID | null {
const safeMs = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, ms));
return _createTimer(callback, safeMs, 0);
}
export function setInterval(
callback: () => Promise<void> | void,
ms: number,
immediate: boolean = false
): TimerID | null {
const safeMs = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, ms));
const expirationDelay = immediate ? 0 : safeMs;
return _createTimer(callback, expirationDelay, safeMs);
}
export function clearTimeout(id: TimerID): void {
clear(id);
}
export function clearInterval(id: TimerID): void {
clear(id);
}
export function clear(id: TimerID): void {
const index = _resolveIndex(id);
if (index === INVALID_INDEX) return;
_deleteTimer(index);
}
export function isActive(id: TimerID): boolean {
return _resolveIndex(id) !== INVALID_INDEX;
}
export function getActiveTimerCount(): number {
return _activeTimerCount;
}
}
// --- SOURCE: node_modules\bf6-portal-utils\events\index.ts ---
export enum EventPriority {
First = -100,
Normal = 0,
Last = 100,
}
namespace EventsTypes {
export const Type = {
OngoingGlobal,
OnTickStart,
OnTickEnd,
OngoingAreaTrigger,
OngoingBlockingSphere,
OngoingBomb,
OngoingCapturePoint,
OngoingEmplacementSpawner,
OngoingHQ,
OngoingInteractPoint,
OngoingLootSpawner,
OngoingMCOM,
OngoingPlayer,
OngoingRingOfFire,
OngoingSector,
OngoingSpawner,
OngoingSpawnPoint,
OngoingTeam,
OngoingVehicle,
OngoingVehicleSpawner,
OngoingWaypointPath,
OngoingWorldIcon,
OnAIMoveToFailed,
OnAIMoveToRunning,
OnAIMoveToSucceeded,
OnAIParachuteRunning,
OnAIParachuteSucceeded,
OnAIWaypointIdleFailed,
OnAIWaypointIdleRunning,
OnAIWaypointIdleSucceeded,
OnBombDropped,
OnBombPickedUp,
OnBombStateChanged,
OnCapturePointCaptured,
OnCapturePointCapturing,
OnCapturePointLost,
OnGameModeEnding,
OnGameModeStarted,
OnGolmudTrainStopped,
OnMandown,
OnMCOMArmed,
OnMCOMDefused,
OnMCOMDestroyed,
OnPlayerDamaged,
OnPlayerDeployed,
OnPlayerDied,
OnPlayerEarnedKill,
OnPlayerEarnedKillAssist,
OnPlayerEmerged,
OnPlayerEnterAreaTrigger,
OnPlayerEnterCapturePoint,
OnPlayerEnteredWater,
OnPlayerEnterVehicle,
OnPlayerEnterVehicleSeat,
OnPlayerEnterVL7Cloud,
OnPlayerExitAreaTrigger,
OnPlayerExitCapturePoint,
OnPlayerExitedWater,
OnPlayerExitVehicle,
OnPlayerExitVehicleSeat,
OnPlayerExitVL7Cloud,
OnPlayerInteract,
OnPlayerJoinGame,
OnPlayerLeaveGame,
OnPlayerSubmerged,
OnPlayerSwitchTeam,
OnPlayerUIButtonEvent,
OnPlayerUndeploy,
OnPortalGadgetAimStart,
OnPortalGadgetAimStop,
OnPortalGadgetFireStart,
OnPortalGadgetFireStop,
OnPortalGadgetLaserToggle,
OnRayCastHit,
OnRayCastMissed,
OnRevived,
OnRingOfFireZoneSizeChange,
OnSpawnerSpawned,
OnTimeLimitReached,
OnVehicleDestroyed,
OnVehicleSpawned,
} as const;
export type Parameters<T> = T extends (...args: infer P) => void ? P : never;
export type Signature = typeof Type;
export type SignatureKey = keyof Signature;
export type TypeValue = Signature[SignatureKey];
export type Channel<K extends SignatureKey> = EventChannel<K>;
export type ChannelsMap = {
[K in SignatureKey]: K extends SignatureKey ? Channel<K> : never;
};
export type HandlerForType<T extends TypeValue> = T extends (...args: infer P) => void
? (...args: P) => void | Promise<void>
: never;
export type EventParameters<T extends TypeValue> = T extends (...args: infer P) => void ? P : never;
export type AllHandlers = {
[K in SignatureKey]: Signature[K] extends (...args: infer P) => void
? (...args: P) => void | Promise<void>
: never;
}[SignatureKey];
export type TriggerWithChannel = TypeValue & {
_channel?: EventChannel<SignatureKey>;
};
}
namespace EventsPrivate {
export const LOG_TIMEOUT_MS = 10_000;
export const logging = new Logging('Events');
let isTickEndPending = false;
export function scheduleTickEnd(): void {
if (isTickEndPending) return;
isTickEndPending = true;
mod.Wait(0).then(onTickEndPromiseResolved);
}
function onTickEndPromiseResolved(): void {
isTickEndPending = false;
OnTickEnd();
}
}
class EventChannel<K extends EventsTypes.SignatureKey> {
public handlers: EventsTypes.HandlerForType<EventsTypes.Signature[K]>[] | null = null;
public priorities: number[] | null = null;
public incompleteTriggers = 0;
public logTimeout: number | null = null;
constructor(public readonly typeValue: EventsTypes.Signature[K]) {}
public subscribe(
handler: EventsTypes.HandlerForType<EventsTypes.Signature[K]>,
priority: number = EventPriority.Normal
): () => void {
if (!this.handlers || !this.priorities) {
this.handlers = [handler];
this.priorities = [priority];
} else {
const handlers = this.handlers.slice();
const priorities = this.priorities.slice();
const len = priorities.length;
let insertIdx = len;
for (let i = 0; i < len; ++i) {
if (priorities[i] > priority) {
insertIdx = i;
break;
}
}
handlers.splice(insertIdx, 0, handler);
priorities.splice(insertIdx, 0, priority);
this.handlers = handlers;
this.priorities = priorities;
}
return () => this.unsubscribe(handler);
}
public unsubscribe(handler: EventsTypes.HandlerForType<EventsTypes.Signature[K]>): void {
if (!this.handlers || !this.priorities) return;
const idx = this.handlers.indexOf(handler);
if (idx === -1) return;
if (this.handlers.length === 1) {
this.handlers = null;
this.priorities = null;
} else {
const handlers = this.handlers.slice();
const priorities = this.priorities.slice();
handlers.splice(idx, 1);
priorities.splice(idx, 1);
this.handlers = handlers;
this.priorities = priorities;
}
}
public trigger(...args: EventsTypes.EventParameters<EventsTypes.Signature[K]>): void;
public trigger(a?: unknown, b?: unknown, c?: unknown, d?: unknown): void {
const handlers = this.handlers;
if (!handlers) return;
const len = handlers.length;
if (len === 0) return;
if (this.incompleteTriggers > 0 && !this.logTimeout) {
const processIncompleteTriggers = () => {
this.logTimeout = null;
EventsPrivate.logging.log(
`${this.incompleteTriggers} incomplete triggers for ${this.typeValue?.name ?? 'unknown'} in last ${EventsPrivate.LOG_TIMEOUT_MS}ms`,
Logging.LogLevel.Warning
);
this.incompleteTriggers = 0;
};
this.logTimeout = Timers.setTimeout(processIncompleteTriggers, EventsPrivate.LOG_TIMEOUT_MS);
}
++this.incompleteTriggers;
for (let i = 0; i < len; ++i) {
CallbackHandler.invoke(
handlers[i] as (...args: unknown[]) => Promise<void> | void,
a,
b,
c,
d,
EventsPrivate.logging,
'trigger'
);
}
--this.incompleteTriggers;
}
public handlerCount(): number {
return this.handlers?.length ?? 0;
}
}
class EventsImplementation {
public static readonly Type = EventsTypes.Type;
public static readonly EventPriority = EventPriority;
public static readonly LogLevel = Logging.LogLevel;
static {
const typeKeys = Object.keys(EventsTypes.Type) as EventsTypes.SignatureKey[];
for (const key of typeKeys) {
const typeValue = EventsTypes.Type[key];
const channel = new EventChannel(typeValue);
(typeValue as EventsTypes.TriggerWithChannel)._channel = channel;
(
EventsImplementation as unknown as Record<
EventsTypes.SignatureKey,
EventChannel<EventsTypes.SignatureKey>
>
)[key] = channel;
}
const ongoingGlobalChannel = (
EventsImplementation as unknown as Record<EventsTypes.SignatureKey, EventChannel<EventsTypes.SignatureKey>>
)['OngoingGlobal'];
(EventsImplementation as unknown as Record<EventsTypes.SignatureKey, EventChannel<EventsTypes.SignatureKey>>)[
'OnTickStart'
] = ongoingGlobalChannel;
(EventsTypes.Type.OnTickStart as EventsTypes.TriggerWithChannel)._channel = ongoingGlobalChannel;
}
private constructor() {}
private static getChannel(type: EventsTypes.TypeValue): EventChannel<EventsTypes.SignatureKey> {
const typeWithChannel = type as EventsTypes.TriggerWithChannel;
let channel = typeWithChannel._channel;
if (!channel) {
channel = new EventChannel(type);
typeWithChannel._channel = channel;
}
return channel;
}
public static setLogging(
log?: (text: string, error?: unknown) => Promise<void> | void,
logLevel?: Logging.LogLevel,
includeRawError?: boolean
): void {
EventsPrivate.logging.setLogging(log, logLevel, includeRawError);
}
public static subscribe<T extends EventsTypes.TypeValue>(
type: T,
handler: EventsTypes.HandlerForType<T>,
priority: number = EventPriority.Normal
): () => void {
return EventsImplementation.getChannel(type).subscribe(
handler as unknown as EventsTypes.HandlerForType<EventsTypes.Signature[EventsTypes.SignatureKey]>,
priority
);
}
public static unsubscribe<T extends EventsTypes.TypeValue>(type: T, handler: EventsTypes.HandlerForType<T>): void {
EventsImplementation.getChannel(type).unsubscribe(
handler as unknown as EventsTypes.HandlerForType<EventsTypes.Signature[EventsTypes.SignatureKey]>
);
}
public static trigger<T extends EventsTypes.TypeValue>(type: T, ...args: EventsTypes.EventParameters<T>): void {
(
EventsImplementation.getChannel(type) as unknown as {
trigger(a?: unknown, b?: unknown, c?: unknown, d?: unknown): void;
}
).trigger(args[0], args[1], args[2], args[3]);
}
public static handlerCount<T extends EventsTypes.TypeValue>(type: T): number {
return EventsImplementation.getChannel(type).handlerCount();
}
}
export const Events = EventsImplementation as typeof EventsImplementation & EventsTypes.ChannelsMap;
export function OngoingGlobal(): void {
EventsPrivate.scheduleTickEnd();
Events.OngoingGlobal.trigger();
}
export function OnTickStart(): void {
OngoingGlobal();
}
export function OnTickEnd(): void {
Events.OnTickEnd.trigger();
}
export function OngoingAreaTrigger(areaTrigger: mod.AreaTrigger): void {
Events.OngoingAreaTrigger.trigger(areaTrigger);
}
export function OngoingBlockingSphere(blockingSphere: mod.BlockingSphere): void {
Events.OngoingBlockingSphere.trigger(blockingSphere);
}
export function OngoingBomb(bomb: mod.Bomb): void {
Events.OngoingBomb.trigger(bomb);
}
export function OngoingCapturePoint(capturePoint: mod.CapturePoint): void {
Events.OngoingCapturePoint.trigger(capturePoint);
}
export function OngoingEmplacementSpawner(emplacementSpawner: mod.EmplacementSpawner): void {
Events.OngoingEmplacementSpawner.trigger(emplacementSpawner);
}
export function OngoingHQ(hq: mod.HQ): void {
Events.OngoingHQ.trigger(hq);
}
export function OngoingInteractPoint(interactPoint: mod.InteractPoint): void {
Events.OngoingInteractPoint.trigger(interactPoint);
}
export function OngoingLootSpawner(lootSpawner: mod.LootSpawner): void {
Events.OngoingLootSpawner.trigger(lootSpawner);
}
export function OngoingMCOM(mcom: mod.MCOM): void {
Events.OngoingMCOM.trigger(mcom);
}
export function OngoingPlayer(player: mod.Player): void {
Events.OngoingPlayer.trigger(player);
}
export function OngoingRingOfFire(ringOfFire: mod.RingOfFire): void {
Events.OngoingRingOfFire.trigger(ringOfFire);
}
export function OngoingSector(sector: mod.Sector): void {
Events.OngoingSector.trigger(sector);
}
export function OngoingSpawner(spawner: mod.Spawner): void {
Events.OngoingSpawner.trigger(spawner);
}
export function OngoingSpawnPoint(spawnPoint: mod.SpawnPoint): void {
Events.OngoingSpawnPoint.trigger(spawnPoint);
}
export function OngoingTeam(team: mod.Team): void {
Events.OngoingTeam.trigger(team);
}
export function OngoingVehicle(vehicle: mod.Vehicle): void {
Events.OngoingVehicle.trigger(vehicle);
}
export function OngoingVehicleSpawner(vehicleSpawner: mod.VehicleSpawner): void {
Events.OngoingVehicleSpawner.trigger(vehicleSpawner);
}
export function OngoingWaypointPath(waypointPath: mod.WaypointPath): void {
Events.OngoingWaypointPath.trigger(waypointPath);
}
export function OngoingWorldIcon(worldIcon: mod.WorldIcon): void {
Events.OngoingWorldIcon.trigger(worldIcon);
}
export function OnAIMoveToFailed(player: mod.Player): void {
Events.OnAIMoveToFailed.trigger(player);
}
export function OnAIMoveToRunning(player: mod.Player): void {
Events.OnAIMoveToRunning.trigger(player);
}
export function OnAIMoveToSucceeded(player: mod.Player): void {
Events.OnAIMoveToSucceeded.trigger(player);
}
export function OnAIParachuteRunning(player: mod.Player): void {
Events.OnAIParachuteRunning.trigger(player);
}
export function OnAIParachuteSucceeded(player: mod.Player): void {
Events.OnAIParachuteSucceeded.trigger(player);
}
export function OnAIWaypointIdleFailed(player: mod.Player): void {
Events.OnAIWaypointIdleFailed.trigger(player);
}
export function OnAIWaypointIdleRunning(player: mod.Player): void {
Events.OnAIWaypointIdleRunning.trigger(player);
}
export function OnAIWaypointIdleSucceeded(player: mod.Player): void {
Events.OnAIWaypointIdleSucceeded.trigger(player);
}
export function OnBombDropped(bomb: mod.Bomb, player: mod.Player): void {
Events.OnBombDropped.trigger(bomb, player);
}
export function OnBombPickedUp(bomb: mod.Bomb, player: mod.Player): void {
Events.OnBombPickedUp.trigger(bomb, player);
}
export function OnBombStateChanged(bomb: mod.Bomb, state: mod.BombState): void {
Events.OnBombStateChanged.trigger(bomb, state);
}
export function OnCapturePointCaptured(capturePoint: mod.CapturePoint): void {
Events.OnCapturePointCaptured.trigger(capturePoint);
}
export function OnCapturePointCapturing(capturePoint: mod.CapturePoint): void {
Events.OnCapturePointCapturing.trigger(capturePoint);
}
export function OnCapturePointLost(capturePoint: mod.CapturePoint): void {
Events.OnCapturePointLost.trigger(capturePoint);
}
export function OnGameModeEnding(): void {
Events.OnGameModeEnding.trigger();
}
export function OnGameModeStarted(): void {
Events.OnGameModeStarted.trigger();
}
export function OnGolmudTrainStopped(reason: mod.GolmudTrainStopReason): void {
Events.OnGolmudTrainStopped.trigger(reason);
}
export function OnMandown(player: mod.Player, otherPlayer: mod.Player): void {
Events.OnMandown.trigger(player, otherPlayer);
}
export function OnMCOMArmed(mcom: mod.MCOM): void {
Events.OnMCOMArmed.trigger(mcom);
}
export function OnMCOMDefused(mcom: mod.MCOM): void {
Events.OnMCOMDefused.trigger(mcom);
}
export function OnMCOMDestroyed(mcom: mod.MCOM): void {
Events.OnMCOMDestroyed.trigger(mcom);
}
export function OnPlayerDamaged(
damagedPlayer: mod.Player,
damagingPlayer: mod.Player,
damageType: mod.DamageType,
weapon: mod.WeaponUnlock
): void {
Events.OnPlayerDamaged.trigger(damagedPlayer, damagingPlayer, damageType, weapon);
}
export function OnPlayerDeployed(player: mod.Player): void {
Events.OnPlayerDeployed.trigger(player);
}
export function OnPlayerDied(
victim: mod.Player,
killer: mod.Player,
deathType: mod.DeathType,
weapon: mod.WeaponUnlock
): void {
Events.OnPlayerDied.trigger(victim, killer, deathType, weapon);
}
export function OnPlayerEarnedKill(
killer: mod.Player,
victim: mod.Player,
deathType: mod.DeathType,
weapon: mod.WeaponUnlock
): void {
Events.OnPlayerEarnedKill.trigger(killer, victim, deathType, weapon);
}
export function OnPlayerEarnedKillAssist(assistingPlayer: mod.Player, victim: mod.Player): void {
Events.OnPlayerEarnedKillAssist.trigger(assistingPlayer, victim);
}
export function OnPlayerEmerged(player: mod.Player): void {
Events.OnPlayerEmerged.trigger(player);
}
export function OnPlayerEnterAreaTrigger(player: mod.Player, areaTrigger: mod.AreaTrigger): void {
Events.OnPlayerEnterAreaTrigger.trigger(player, areaTrigger);
}
export function OnPlayerEnterCapturePoint(player: mod.Player, capturePoint: mod.CapturePoint): void {
Events.OnPlayerEnterCapturePoint.trigger(player, capturePoint);
}
export function OnPlayerEnteredWater(player: mod.Player): void {
Events.OnPlayerEnteredWater.trigger(player);
}
export function OnPlayerEnterVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
Events.OnPlayerEnterVehicle.trigger(player, vehicle);
}
export function OnPlayerEnterVehicleSeat(player: mod.Player, vehicle: mod.Vehicle, seat: mod.Object): void {
Events.OnPlayerEnterVehicleSeat.trigger(player, vehicle, seat);
}
export function OnPlayerEnterVL7Cloud(player: mod.Player, cloud: mod.VL7Cloud): void {
Events.OnPlayerEnterVL7Cloud.trigger(player, cloud);
}
export function OnPlayerExitAreaTrigger(player: mod.Player, areaTrigger: mod.AreaTrigger): void {
Events.OnPlayerExitAreaTrigger.trigger(player, areaTrigger);
}
export function OnPlayerExitCapturePoint(player: mod.Player, capturePoint: mod.CapturePoint): void {
Events.OnPlayerExitCapturePoint.trigger(player, capturePoint);
}
export function OnPlayerExitedWater(player: mod.Player): void {
Events.OnPlayerExitedWater.trigger(player);
}
export function OnPlayerExitVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
Events.OnPlayerExitVehicle.trigger(player, vehicle);
}
export function OnPlayerExitVehicleSeat(player: mod.Player, vehicle: mod.Vehicle, seat: mod.Object): void {
Events.OnPlayerExitVehicleSeat.trigger(player, vehicle, seat);
}
export function OnPlayerExitVL7Cloud(player: mod.Player, cloud: mod.VL7Cloud): void {
Events.OnPlayerExitVL7Cloud.trigger(player, cloud);
}
export function OnPlayerInteract(player: mod.Player, interactPoint: mod.InteractPoint): void {
Events.OnPlayerInteract.trigger(player, interactPoint);
}
export function OnPlayerJoinGame(player: mod.Player): void {
Events.OnPlayerJoinGame.trigger(player);
}
export function OnPlayerLeaveGame(playerId: number): void {
Events.OnPlayerLeaveGame.trigger(playerId);
}
export function OnPlayerSubmerged(player: mod.Player): void {
Events.OnPlayerSubmerged.trigger(player);
}
export function OnPlayerSwitchTeam(player: mod.Player, team: mod.Team): void {
Events.OnPlayerSwitchTeam.trigger(player, team);
}
export function OnPlayerUIButtonEvent(
player: mod.Player,
uiWidget: mod.UIWidget,
uiButtonEvent: mod.UIButtonEvent
): void {
Events.OnPlayerUIButtonEvent.trigger(player, uiWidget, uiButtonEvent);
}
export function OnPlayerUndeploy(player: mod.Player): void {
Events.OnPlayerUndeploy.trigger(player);
}
export function OnPortalGadgetAimStart(player: mod.Player): void {
Events.OnPortalGadgetAimStart.trigger(player);
}
export function OnPortalGadgetAimStop(player: mod.Player): void {
Events.OnPortalGadgetAimStop.trigger(player);
}
export function OnPortalGadgetFireStart(player: mod.Player): void {
Events.OnPortalGadgetFireStart.trigger(player);
}
export function OnPortalGadgetFireStop(player: mod.Player): void {
Events.OnPortalGadgetFireStop.trigger(player);
}
export function OnPortalGadgetLaserToggle(player: mod.Player, toggle: boolean): void {
Events.OnPortalGadgetLaserToggle.trigger(player, toggle);
}
export function OnRayCastHit(player: mod.Player, point: mod.Vector, normal: mod.Vector): void {
Events.OnRayCastHit.trigger(player, point, normal);
}
export function OnRayCastMissed(player: mod.Player): void {
Events.OnRayCastMissed.trigger(player);
}
export function OnRevived(revivedPlayer: mod.Player, revivingPlayer: mod.Player): void {
Events.OnRevived.trigger(revivedPlayer, revivingPlayer);
}
export function OnRingOfFireZoneSizeChange(ringOfFire: mod.RingOfFire, number: number): void {
Events.OnRingOfFireZoneSizeChange.trigger(ringOfFire, number);
}
export function OnSpawnerSpawned(player: mod.Player, spawner: mod.Spawner): void {
Events.OnSpawnerSpawned.trigger(player, spawner);
}
export function OnTimeLimitReached(): void {
if (!mod.GetMatchTimeElapsed()) return;
Events.OnTimeLimitReached.trigger();
}
export function OnVehicleDestroyed(vehicle: mod.Vehicle): void {
Events.OnVehicleDestroyed.trigger(vehicle);
}
export function OnVehicleSpawned(vehicle: mod.Vehicle): void {
Events.OnVehicleSpawned.trigger(vehicle);
}
// --- SOURCE: src\catalog.ts ---
export type SfxKind = "oneshot" | "loop";
export type SfxDim = "2d" | "3d";
export interface SfxEntry {
readonly name: string;
readonly display: string;
readonly category: string;
readonly kind: SfxKind;
readonly dim: SfxDim;
readonly windowMs: number;
readonly lengthText: string;
readonly lengthKey: string;
readonly key: string;
readonly catKey: string;
readonly asset: mod.RuntimeSpawn_Common;
}
export interface VfxEntry {
readonly name: string;
readonly display: string;
readonly category: string;
readonly enum: string;
readonly key: string;
readonly catKey: string;
readonly asset: mod.RuntimeSpawn_Common;
}
export interface BannedEntry {
readonly name: string;
readonly reason: string;
}
export const BANNED: readonly BannedEntry[] = [
{ name: "SFX_Levels_Brooklyn_Spots_EmergencyExit_SimpleLoop3D", reason: "Crashes the Battlefield 6 Portal instance on play" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_Water_Splash_Head_SimpleLoop3D", reason: "Crashes the Battlefield 6 Portal instance on play" },
];
export type BannedProof = [
typeof mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_EmergencyExit_SimpleLoop3D,
typeof mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_Water_Splash_Head_SimpleLoop3D,
];
export const SFX_CATEGORIES: readonly string[] = [
"Alarm",
"Destruction_Buildings",
"Destruction_Fuse",
"Destruction_Impacts",
"Destruction_Old",
"Destruction_PreAmble",
"Destruction_Props",
"Destruction_Structural",
"Destruction_Structures",
"Destruction_Tree",
"Gadgets_AdrenalineShot",
"Gadgets_ATMine",
"Gadgets_C4",
"Gadgets_ConcussionGrenade",
"Gadgets_Decoy",
"Gadgets_Defibrillator",
"Gadgets_DeployableCover",
"Gadgets_Drone",
"Gadgets_EIDOS",
"Gadgets_EoDBot",
"Gadgets_EpiPen",
"Gadgets_Flashbang",
"Gadgets_SupplyDrop",
"GameModes_BR",
"GameModes_Gauntlet",
"Gamemodes_Payload",
"GameModes_Rush",
"Levels_Brooklyn",
"Levels_Cairo",
"Projectiles_Flybys",
"Projectiles_FlyBys",
"Soldier_Damage",
"Soldier_Events",
"Soldier_FieldUpgrade",
"Soldier_Health",
"Soldier_Interact",
"Soldier_Melee",
"Soldier_Movement",
"Soldier_Parachute",
"Soldier_Ragdoll",
"Soldier_Revive",
"Soldier_States",
"UI_Commorose",
"UI_Deploy",
"UI_EOR",
"UI_Gamemode",
"UI_Gauntlet",
"UI_Highlight",
"UI_MainMenu",
"UI_Map",
"UI_Matchmaking",
"UI_MenuNavigatin",
"UI_MenuNavigation",
"UI_Notification",
"UI_PreRoundLobby",
"UI_Scorelog",
"UI_Select",
"UI_Shared",
"UI_SP",
"UI_Submenu",
"VOModule_OneShot2D",
];
export const VFX_CATEGORIES: readonly string[] = [
"Airburst",
"Airplane",
"AmbWar",
"ArtilleryStrike",
"Autocannon",
"AW",
"BASE",
"BD",
"Blackhawk",
"BlackLocust",
"Bomb",
"BreachingDart",
"Building",
"Bullet",
"CAP",
"Car",
"CarFire",
"CarlGustaf",
"Carrier",
"Chaingun",
"CIN",
"CivCar",
"Cloud",
"Decoy",
"Defib",
"DeployableCover",
"EODBot",
"Gadget",
"Granite",
"Grenade",
"Impact",
"LoadoutCrate",
"MF",
"Mine",
"Missile",
"Panzerfaust",
"ProjectileTrail",
"ProximityGrenade",
"RepairTool",
"Rocket",
"ShellEjection",
"Smoke",
"Snow",
"SoldierScreen",
"SP",
"Sparks",
"SupplyVehicleStation",
"ThrowingKnife",
"TracerDart",
"Vehicle",
"VFX",
"WireGuidedMissile",
];
export interface PrefixEntry {
readonly token: string;
readonly count: number;
readonly key: string;
}
export const SFX_PREFIXES: readonly PrefixEntry[] = [
{ token: "UI", count: 331, key: "sxp0" },
{ token: "Soldier", count: 200, key: "sxp1" },
{ token: "Levels", count: 136, key: "sxp2" },
{ token: "Gadgets", count: 103, key: "sxp3" },
{ token: "Destruction", count: 68, key: "sxp4" },
{ token: "GameModes", count: 65, key: "sxp5" },
{ token: "Projectiles", count: 31, key: "sxp6" },
{ token: "Alarm", count: 1, key: "sxp7" },
{ token: "VOModule", count: 1, key: "sxp8" },
];
export const VFX_PREFIXES: readonly PrefixEntry[] = [
{ token: "Gadget", count: 106, key: "sxp9" },
{ token: "Grenade", count: 31, key: "sxp10" },
{ token: "Impact", count: 27, key: "sxp11" },
{ token: "BASE", count: 15, key: "sxp12" },
{ token: "Missile", count: 10, key: "sxp13" },
{ token: "Vehicle", count: 10, key: "sxp14" },
{ token: "RepairTool", count: 8, key: "sxp15" },
{ token: "Snow", count: 8, key: "sxp16" },
{ token: "Rocket", count: 7, key: "sxp17" },
{ token: "CIN", count: 6, key: "sxp18" },
{ token: "Cloud", count: 6, key: "sxp19" },
{ token: "Airplane", count: 5, key: "sxp20" },
{ token: "Defib", count: 4, key: "sxp21" },
{ token: "EODBot", count: 4, key: "sxp22" },
{ token: "Granite", count: 4, key: "sxp23" },
{ token: "MF", count: 4, key: "sxp24" },
{ token: "ProjectileTrail", count: 4, key: "sxp25" },
{ token: "ArtilleryStrike", count: 3, key: "sxp26" },
{ token: "BD", count: 3, key: "sxp27" },
{ token: "BreachingDart", count: 3, key: "sxp28" },
{ token: "Airburst", count: 2, key: "sxp29" },
{ token: "Autocannon", count: 2, key: "sxp30" },
{ token: "Blackhawk", count: 2, key: "sxp31" },
{ token: "Bomb", count: 2, key: "sxp32" },
{ token: "CarFire", count: 2, key: "sxp33" },
{ token: "CivCar", count: 2, key: "sxp34" },
{ token: "DeployableCover", count: 2, key: "sxp35" },
{ token: "Launchers", count: 2, key: "sxp36" },
{ token: "LoadoutCrate", count: 2, key: "sxp37" },
{ token: "Mine", count: 2, key: "sxp38" },
{ token: "ProximityGrenade", count: 2, key: "sxp39" },
{ token: "ThrowingKnife", count: 2, key: "sxp40" },
{ token: "AmbWar", count: 1, key: "sxp41" },
{ token: "AW", count: 1, key: "sxp42" },
{ token: "BlackLocust", count: 1, key: "sxp43" },
{ token: "Building", count: 1, key: "sxp44" },
{ token: "Bullet", count: 1, key: "sxp45" },
{ token: "CAP", count: 1, key: "sxp46" },
{ token: "Car", count: 1, key: "sxp47" },
{ token: "CarlGustaf", count: 1, key: "sxp48" },
{ token: "Carrier", count: 1, key: "sxp49" },
{ token: "Chaingun", count: 1, key: "sxp50" },
{ token: "Decoy", count: 1, key: "sxp51" },
{ token: "Panzerfaust", count: 1, key: "sxp52" },
{ token: "ShellEjection", count: 1, key: "sxp53" },
{ token: "Smoke", count: 1, key: "sxp54" },
{ token: "SoldierScreen", count: 1, key: "sxp55" },
{ token: "SP", count: 1, key: "sxp56" },
{ token: "Sparks", count: 1, key: "sxp57" },
{ token: "SupplyVehicleStation", count: 1, key: "sxp58" },
{ token: "TracerDart", count: 1, key: "sxp59" },
{ token: "WireGuidedMissile", count: 1, key: "sxp60" },
];
export const SFX_CATALOG: readonly SfxEntry[] = [
{ name: "SFX_Alarm", display: "Alarm", category: "Alarm", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Alarm, key: "sxa0", catKey: "sxg0" },
{ name: "SFX_Destruction_Buildings_CrowsNest_Collapse_All_OneShot3D", display: "Buildings CrowsNest Collapse All OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 21960, lengthText: "17s+", lengthKey: "sxl17p", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_CrowsNest_Collapse_All_OneShot3D, key: "sxa1", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_CrowsNest_Collapse_Close_OneShot3D", display: "Buildings CrowsNest Collapse Close OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 22000, lengthText: "17s+", lengthKey: "sxl17p", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_CrowsNest_Collapse_Close_OneShot3D, key: "sxa2", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_CrowsNest_Collapse_Distant_OneShot3D", display: "Buildings CrowsNest Collapse Distant OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 22000, lengthText: "17s+", lengthKey: "sxl17p", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_CrowsNest_Collapse_Distant_OneShot3D, key: "sxa3", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_CrowsNest_Collapse_LFE_OneShot3D", display: "Buildings CrowsNest Collapse LFE OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 22000, lengthText: "17s+", lengthKey: "sxl17p", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_CrowsNest_Collapse_LFE_OneShot3D, key: "sxa4", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_CrowsNest_Preamble_Distant_OneShot3D", display: "Buildings CrowsNest Preamble Distant OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 14340, lengthText: "13.3s", lengthKey: "sxl133", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_CrowsNest_Preamble_Distant_OneShot3D, key: "sxa5", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_CrowsNest_Preamble_LFE_OneShot3D", display: "Buildings CrowsNest Preamble LFE OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 14720, lengthText: "13.7s", lengthKey: "sxl137", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_CrowsNest_Preamble_LFE_OneShot3D, key: "sxa6", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_CrowsNest_Preamble_OneShot3D", display: "Buildings CrowsNest Preamble OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 14400, lengthText: "13.4s", lengthKey: "sxl134", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_CrowsNest_Preamble_OneShot3D, key: "sxa7", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_GasStation_Collapse_Distant_OneShot3D", display: "Buildings GasStation Collapse Distant OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 11640, lengthText: "10.6s", lengthKey: "sxl106", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_GasStation_Collapse_Distant_OneShot3D, key: "sxa8", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_GasStation_Collapse_LFE_OneShot3D", display: "Buildings GasStation Collapse LFE OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 11670, lengthText: "10.7s", lengthKey: "sxl107", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_GasStation_Collapse_LFE_OneShot3D, key: "sxa9", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_GasStation_Collapse_OneShot3D", display: "Buildings GasStation Collapse OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 12450, lengthText: "11.5s", lengthKey: "sxl115", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_GasStation_Collapse_OneShot3D, key: "sxa10", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_HouseCollapse_OneShot3D", display: "Buildings HouseCollapse OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 14550, lengthText: "13.6s", lengthKey: "sxl136", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_HouseCollapse_OneShot3D, key: "sxa11", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_SolarArray_Large_Distant_OneShot3D", display: "Buildings SolarArray Large Distant OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 9810, lengthText: "8.8s", lengthKey: "sxl88", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_SolarArray_Large_Distant_OneShot3D, key: "sxa12", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_SolarArray_Large_LFE_OneShot3D", display: "Buildings SolarArray Large LFE OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 9350, lengthText: "8.4s", lengthKey: "sxl84", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_SolarArray_Large_LFE_OneShot3D, key: "sxa13", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_SolarArray_Large_OneShot3D", display: "Buildings SolarArray Large OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 8890, lengthText: "7.9s", lengthKey: "sxl79", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_SolarArray_Large_OneShot3D, key: "sxa14", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_SolarArray_Medium_Distant_OneShot3D", display: "Buildings SolarArray Medium Distant OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 6810, lengthText: "5.8s", lengthKey: "sxl58", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_SolarArray_Medium_Distant_OneShot3D, key: "sxa15", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_SolarArray_Medium_LFE_OneShot3D", display: "Buildings SolarArray Medium LFE OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 6840, lengthText: "5.8s", lengthKey: "sxl58", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_SolarArray_Medium_LFE_OneShot3D, key: "sxa16", catKey: "sxg1" },
{ name: "SFX_Destruction_Buildings_SolarArray_Medium_OneShot3D", display: "Buildings SolarArray Medium OneShot3D", category: "Destruction_Buildings", kind: "oneshot", dim: "3d", windowMs: 5140, lengthText: "4.1s", lengthKey: "sxl41", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Buildings_SolarArray_Medium_OneShot3D, key: "sxa17", catKey: "sxg1" },
{ name: "SFX_Destruction_Fuse_Loop_EngineCrackle_SimpleLoop3D", display: "Fuse Loop EngineCrackle SimpleLoop3D", category: "Destruction_Fuse", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Fuse_Loop_EngineCrackle_SimpleLoop3D, key: "sxa18", catKey: "sxg2" },
{ name: "SFX_Destruction_Fuse_Loop_GasFire_SimpleLoop3D", display: "Fuse Loop GasFire SimpleLoop3D", category: "Destruction_Fuse", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Fuse_Loop_GasFire_SimpleLoop3D, key: "sxa19", catKey: "sxg2" },
{ name: "SFX_Destruction_Fuse_Loop_LingeringWreckFire_SimpleLoop3D", display: "Fuse Loop LingeringWreckFire SimpleLoop3D", category: "Destruction_Fuse", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Fuse_Loop_LingeringWreckFire_SimpleLoop3D, key: "sxa20", catKey: "sxg2" },
{ name: "SFX_Destruction_Fuse_Loop_WreckFire_SimpleLoop3D", display: "Fuse Loop WreckFire SimpleLoop3D", category: "Destruction_Fuse", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Fuse_Loop_WreckFire_SimpleLoop3D, key: "sxa21", catKey: "sxg2" },
{ name: "SFX_Destruction_Fuse_OneShot_GasFireIgnition_OneShot3D", display: "Fuse OneShot GasFireIgnition OneShot3D", category: "Destruction_Fuse", kind: "oneshot", dim: "3d", windowMs: 9060, lengthText: "8.1s", lengthKey: "sxl81", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Fuse_OneShot_GasFireIgnition_OneShot3D, key: "sxa22", catKey: "sxg2" },
{ name: "SFX_Destruction_Fuse_OneShot_OilSpill_OneShot3D", display: "Fuse OneShot OilSpill OneShot3D", category: "Destruction_Fuse", kind: "oneshot", dim: "3d", windowMs: 3070, lengthText: "2.1s", lengthKey: "sxl21", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Fuse_OneShot_OilSpill_OneShot3D, key: "sxa23", catKey: "sxg2" },
{ name: "SFX_Destruction_Fuse_OneShot_VehicleIgnition_OneShot3D", display: "Fuse OneShot VehicleIgnition OneShot3D", category: "Destruction_Fuse", kind: "oneshot", dim: "3d", windowMs: 9400, lengthText: "8.4s", lengthKey: "sxl84", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Fuse_OneShot_VehicleIgnition_OneShot3D, key: "sxa24", catKey: "sxg2" },
{ name: "SFX_Destruction_Impacts_Brick_Small_OneShot3D", display: "Impacts Brick Small OneShot3D", category: "Destruction_Impacts", kind: "oneshot", dim: "3d", windowMs: 3650, lengthText: "2.7s", lengthKey: "sxl27", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Impacts_Brick_Small_OneShot3D, key: "sxa25", catKey: "sxg3" },
{ name: "SFX_Destruction_Impacts_BrickWall_OneShot3D", display: "Impacts BrickWall OneShot3D", category: "Destruction_Impacts", kind: "oneshot", dim: "3d", windowMs: 4510, lengthText: "3.5s", lengthKey: "sxl35", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Impacts_BrickWall_OneShot3D, key: "sxa26", catKey: "sxg3" },
{ name: "SFX_Destruction_Impacts_Concrete_Prop_OneShot3D", display: "Impacts Concrete Prop OneShot3D", category: "Destruction_Impacts", kind: "oneshot", dim: "3d", windowMs: 4040, lengthText: "3.0s", lengthKey: "sxl30", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Impacts_Concrete_Prop_OneShot3D, key: "sxa27", catKey: "sxg3" },
{ name: "SFX_Destruction_Impacts_Metal_Prop_OneShot3D", display: "Impacts Metal Prop OneShot3D", category: "Destruction_Impacts", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Impacts_Metal_Prop_OneShot3D, key: "sxa28", catKey: "sxg3" },
{ name: "SFX_Destruction_Impacts_Metal_Structural_Medium_OneShot3D", display: "Impacts Metal Structural Medium OneShot3D", category: "Destruction_Impacts", kind: "oneshot", dim: "3d", windowMs: 3110, lengthText: "2.1s", lengthKey: "sxl21", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Impacts_Metal_Structural_Medium_OneShot3D, key: "sxa29", catKey: "sxg3" },
{ name: "SFX_Destruction_Impacts_Plaster_Structural_OneShot3D", display: "Impacts Plaster Structural OneShot3D", category: "Destruction_Impacts", kind: "oneshot", dim: "3d", windowMs: 3000, lengthText: "2.0s", lengthKey: "sxl20", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Impacts_Plaster_Structural_OneShot3D, key: "sxa30", catKey: "sxg3" },
{ name: "SFX_Destruction_Impacts_Plastic_Prop_OneShot3D", display: "Impacts Plastic Prop OneShot3D", category: "Destruction_Impacts", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Impacts_Plastic_Prop_OneShot3D, key: "sxa31", catKey: "sxg3" },
{ name: "SFX_Destruction_Impacts_Tile_Large_OneShot3D", display: "Impacts Tile Large OneShot3D", category: "Destruction_Impacts", kind: "oneshot", dim: "3d", windowMs: 2550, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Impacts_Tile_Large_OneShot3D, key: "sxa32", catKey: "sxg3" },
{ name: "SFX_Destruction_Impacts_Vehicle_Car_OneShot3D", display: "Impacts Vehicle Car OneShot3D", category: "Destruction_Impacts", kind: "oneshot", dim: "3d", windowMs: 5130, lengthText: "4.1s", lengthKey: "sxl41", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Impacts_Vehicle_Car_OneShot3D, key: "sxa33", catKey: "sxg3" },
{ name: "SFX_Destruction__Old_Ceramic_Generic_OneShot3D", display: "Old Ceramic Generic OneShot3D", category: "Destruction_Old", kind: "oneshot", dim: "3d", windowMs: 3270, lengthText: "2.3s", lengthKey: "sxl23", asset: mod.RuntimeSpawn_Common.SFX_Destruction__Old_Ceramic_Generic_OneShot3D, key: "sxa34", catKey: "sxg4" },
{ name: "SFX_Destruction_PreAmble_Brick_OneShot3D", display: "PreAmble Brick OneShot3D", category: "Destruction_PreAmble", kind: "oneshot", dim: "3d", windowMs: 8130, lengthText: "7.1s", lengthKey: "sxl71", asset: mod.RuntimeSpawn_Common.SFX_Destruction_PreAmble_Brick_OneShot3D, key: "sxa35", catKey: "sxg5" },
{ name: "SFX_Destruction_Props_FX_Electric_PropExplosionPowerline_Medium_OneShot3D", display: "Props FX Electric PropExplosionPowerline Medium OneShot3D", category: "Destruction_Props", kind: "oneshot", dim: "3d", windowMs: 2570, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Props_FX_Electric_PropExplosionPowerline_Medium_OneShot3D, key: "sxa36", catKey: "sxg6" },
{ name: "SFX_Destruction_Props_Liquids_WaterTank_Large_OneShot3D", display: "Props Liquids WaterTank Large OneShot3D", category: "Destruction_Props", kind: "oneshot", dim: "3d", windowMs: 5580, lengthText: "4.6s", lengthKey: "sxl46", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Props_Liquids_WaterTank_Large_OneShot3D, key: "sxa37", catKey: "sxg6" },
{ name: "SFX_Destruction_Props_Paper_OneShot3D", display: "Props Paper OneShot3D", category: "Destruction_Props", kind: "oneshot", dim: "3d", windowMs: 3780, lengthText: "2.8s", lengthKey: "sxl28", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Props_Paper_OneShot3D, key: "sxa38", catKey: "sxg6" },
{ name: "SFX_Destruction_Props_Special_Piano_DestroyedState_OneShot3D", display: "Props Special Piano DestroyedState OneShot3D", category: "Destruction_Props", kind: "oneshot", dim: "3d", windowMs: 4450, lengthText: "3.5s", lengthKey: "sxl35", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Props_Special_Piano_DestroyedState_OneShot3D, key: "sxa39", catKey: "sxg6" },
{ name: "SFX_Destruction_Props_Special_Piano_OneShot3D", display: "Props Special Piano OneShot3D", category: "Destruction_Props", kind: "oneshot", dim: "3d", windowMs: 7070, lengthText: "6.1s", lengthKey: "sxl61", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Props_Special_Piano_OneShot3D, key: "sxa40", catKey: "sxg6" },
{ name: "SFX_Destruction_Props_Wood_Generic_Small_OneShot3D", display: "Props Wood Generic Small OneShot3D", category: "Destruction_Props", kind: "oneshot", dim: "3d", windowMs: 3340, lengthText: "2.3s", lengthKey: "sxl23", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Props_Wood_Generic_Small_OneShot3D, key: "sxa41", catKey: "sxg6" },
{ name: "SFX_Destruction_Structural_CloseDebris_Generic_OneShot3D", display: "Structural CloseDebris Generic OneShot3D", category: "Destruction_Structural", kind: "oneshot", dim: "3d", windowMs: 5690, lengthText: "4.7s", lengthKey: "sxl47", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Structural_CloseDebris_Generic_OneShot3D, key: "sxa42", catKey: "sxg7" },
{ name: "SFX_Destruction_Structural_CloseDebris_Wood_OneShot3D", display: "Structural CloseDebris Wood OneShot3D", category: "Destruction_Structural", kind: "oneshot", dim: "3d", windowMs: 4700, lengthText: "3.7s", lengthKey: "sxl37", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Structural_CloseDebris_Wood_OneShot3D, key: "sxa43", catKey: "sxg7" },
{ name: "SFX_Destruction_Structural_Debrispile_OneShot3D", display: "Structural Debrispile OneShot3D", category: "Destruction_Structural", kind: "oneshot", dim: "3d", windowMs: 5380, lengthText: "4.4s", lengthKey: "sxl44", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Structural_Debrispile_OneShot3D, key: "sxa44", catKey: "sxg7" },
{ name: "SFX_Destruction_Structural_Metal_GasStation_OneShot3D", display: "Structural Metal GasStation OneShot3D", category: "Destruction_Structural", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Structural_Metal_GasStation_OneShot3D, key: "sxa45", catKey: "sxg7" },
{ name: "SFX_Destruction_Structures_BrickWall_Small_Close_OneShot3D", display: "Structures BrickWall Small Close OneShot3D", category: "Destruction_Structures", kind: "oneshot", dim: "3d", windowMs: 4880, lengthText: "3.9s", lengthKey: "sxl39", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Structures_BrickWall_Small_Close_OneShot3D, key: "sxa46", catKey: "sxg8" },
{ name: "SFX_Destruction_Tree_Dead_Collision_Large_OneShot3D", display: "Tree Dead Collision Large OneShot3D", category: "Destruction_Tree", kind: "oneshot", dim: "3d", windowMs: 4150, lengthText: "3.2s", lengthKey: "sxl32", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Dead_Collision_Large_OneShot3D, key: "sxa47", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_Leafy_Collision_Large_OneShot3D", display: "Tree Leafy Collision Large OneShot3D", category: "Destruction_Tree", kind: "oneshot", dim: "3d", windowMs: 5970, lengthText: "5.0s", lengthKey: "sxl50", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Leafy_Collision_Large_OneShot3D, key: "sxa48", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_Leafy_Collision_Medium_OneShot3D", display: "Tree Leafy Collision Medium OneShot3D", category: "Destruction_Tree", kind: "oneshot", dim: "3d", windowMs: 4250, lengthText: "3.3s", lengthKey: "sxl33", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Leafy_Collision_Medium_OneShot3D, key: "sxa49", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_Leafy_Falling_Medium_SimpleLoop3D", display: "Tree Leafy Falling Medium SimpleLoop3D", category: "Destruction_Tree", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Leafy_Falling_Medium_SimpleLoop3D, key: "sxa50", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_Leafy_Start_Large_OneShot3D", display: "Tree Leafy Start Large OneShot3D", category: "Destruction_Tree", kind: "oneshot", dim: "3d", windowMs: 5210, lengthText: "4.2s", lengthKey: "sxl42", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Leafy_Start_Large_OneShot3D, key: "sxa51", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_Leafy_Start_Medium_OneShot3D", display: "Tree Leafy Start Medium OneShot3D", category: "Destruction_Tree", kind: "oneshot", dim: "3d", windowMs: 5890, lengthText: "4.9s", lengthKey: "sxl49", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Leafy_Start_Medium_OneShot3D, key: "sxa52", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_Palm_Collision_Large_OneShot3D", display: "Tree Palm Collision Large OneShot3D", category: "Destruction_Tree", kind: "oneshot", dim: "3d", windowMs: 4470, lengthText: "3.5s", lengthKey: "sxl35", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Palm_Collision_Large_OneShot3D, key: "sxa53", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_Palm_Falling_Large_SimpleLoop3D", display: "Tree Palm Falling Large SimpleLoop3D", category: "Destruction_Tree", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Palm_Falling_Large_SimpleLoop3D, key: "sxa54", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_Palm_Falling_Medium_SimpleLoop3D", display: "Tree Palm Falling Medium SimpleLoop3D", category: "Destruction_Tree", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Palm_Falling_Medium_SimpleLoop3D, key: "sxa55", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_Palm_Start_Large_SimpleLoop3D", display: "Tree Palm Start Large SimpleLoop3D", category: "Destruction_Tree", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Palm_Start_Large_SimpleLoop3D, key: "sxa56", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_PineLoblolly_Collision_Large_OneShot3D", display: "Tree PineLoblolly Collision Large OneShot3D", category: "Destruction_Tree", kind: "oneshot", dim: "3d", windowMs: 6540, lengthText: "5.5s", lengthKey: "sxl55", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_PineLoblolly_Collision_Large_OneShot3D, key: "sxa57", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_PineLoblolly_Collision_Medium_OneShot3D", display: "Tree PineLoblolly Collision Medium OneShot3D", category: "Destruction_Tree", kind: "oneshot", dim: "3d", windowMs: 7700, lengthText: "6.7s", lengthKey: "sxl67", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_PineLoblolly_Collision_Medium_OneShot3D, key: "sxa58", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_PineLoblolly_Collision_Small_OneShot3D", display: "Tree PineLoblolly Collision Small OneShot3D", category: "Destruction_Tree", kind: "oneshot", dim: "3d", windowMs: 6200, lengthText: "5.2s", lengthKey: "sxl52", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_PineLoblolly_Collision_Small_OneShot3D, key: "sxa59", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_PineLoblolly_Falling_Large_SimpleLoop3D", display: "Tree PineLoblolly Falling Large SimpleLoop3D", category: "Destruction_Tree", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_PineLoblolly_Falling_Large_SimpleLoop3D, key: "sxa60", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_PineLoblolly_Falling_Small_SimpleLoop3D", display: "Tree PineLoblolly Falling Small SimpleLoop3D", category: "Destruction_Tree", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_PineLoblolly_Falling_Small_SimpleLoop3D, key: "sxa61", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_PineLoblolly_Start_Large_OneShot3D", display: "Tree PineLoblolly Start Large OneShot3D", category: "Destruction_Tree", kind: "oneshot", dim: "3d", windowMs: 4570, lengthText: "3.6s", lengthKey: "sxl36", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_PineLoblolly_Start_Large_OneShot3D, key: "sxa62", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_PineLoblolly_Start_Small_OneShot3D", display: "Tree PineLoblolly Start Small OneShot3D", category: "Destruction_Tree", kind: "oneshot", dim: "3d", windowMs: 5800, lengthText: "4.8s", lengthKey: "sxl48", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_PineLoblolly_Start_Small_OneShot3D, key: "sxa63", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_Poplar_Falling_Small_SimpleLoop3D", display: "Tree Poplar Falling Small SimpleLoop3D", category: "Destruction_Tree", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Poplar_Falling_Small_SimpleLoop3D, key: "sxa64", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_Poplar_Start_Medium_OneShot3D", display: "Tree Poplar Start Medium OneShot3D", category: "Destruction_Tree", kind: "oneshot", dim: "3d", windowMs: 6910, lengthText: "5.9s", lengthKey: "sxl59", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Poplar_Start_Medium_OneShot3D, key: "sxa65", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_Walnut_Start_Small_OneShot3D", display: "Tree Walnut Start Small OneShot3D", category: "Destruction_Tree", kind: "oneshot", dim: "3d", windowMs: 6280, lengthText: "5.3s", lengthKey: "sxl53", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Walnut_Start_Small_OneShot3D, key: "sxa66", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_Whoosh_Large_SimpleLoop3D", display: "Tree Whoosh Large SimpleLoop3D", category: "Destruction_Tree", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_Whoosh_Large_SimpleLoop3D, key: "sxa67", catKey: "sxg9" },
{ name: "SFX_Destruction_Tree_WhooshTest_SimpleLoop3D", display: "Tree WhooshTest SimpleLoop3D", category: "Destruction_Tree", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Destruction_Tree_WhooshTest_SimpleLoop3D, key: "sxa68", catKey: "sxg9" },
{ name: "SFX_Gadgets_AdrenalineShot_1pExperience_OneShot2D", display: "AdrenalineShot 1pExperience OneShot2D", category: "Gadgets_AdrenalineShot", kind: "oneshot", dim: "2d", windowMs: 4260, lengthText: "3.3s", lengthKey: "sxl33", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_1pExperience_OneShot2D, key: "sxa69", catKey: "sxg10" },
{ name: "SFX_Gadgets_AdrenalineShot_1pExperience_SimpleLoop2D", display: "AdrenalineShot 1pExperience SimpleLoop2D", category: "Gadgets_AdrenalineShot", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_1pExperience_SimpleLoop2D, key: "sxa70", catKey: "sxg10" },
{ name: "SFX_Gadgets_AdrenalineShot_1pRiser_OneShot2D", display: "AdrenalineShot 1pRiser OneShot2D", category: "Gadgets_AdrenalineShot", kind: "oneshot", dim: "2d", windowMs: 5760, lengthText: "4.8s", lengthKey: "sxl48", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_1pRiser_OneShot2D, key: "sxa71", catKey: "sxg10" },
{ name: "SFX_Gadgets_AdrenalineShot_1pStop_OneShot2D", display: "AdrenalineShot 1pStop OneShot2D", category: "Gadgets_AdrenalineShot", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_1pStop_OneShot2D, key: "sxa72", catKey: "sxg10" },
{ name: "SFX_Gadgets_AdrenalineShot_Commando_1pExperience_OneShot2D", display: "AdrenalineShot Commando 1pExperience OneShot2D", category: "Gadgets_AdrenalineShot", kind: "oneshot", dim: "2d", windowMs: 6350, lengthText: "5.4s", lengthKey: "sxl54", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_Commando_1pExperience_OneShot2D, key: "sxa73", catKey: "sxg10" },
{ name: "SFX_Gadgets_AdrenalineShot_Effort_Female_OneShot2D", display: "AdrenalineShot Effort Female OneShot2D", category: "Gadgets_AdrenalineShot", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_Effort_Female_OneShot2D, key: "sxa74", catKey: "sxg10" },
{ name: "SFX_Gadgets_AdrenalineShot_Effort_Male_OneShot2D", display: "AdrenalineShot Effort Male OneShot2D", category: "Gadgets_AdrenalineShot", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_Effort_Male_OneShot2D, key: "sxa75", catKey: "sxg10" },
{ name: "SFX_Gadgets_AdrenalineShot_Start_OneShot2D", display: "AdrenalineShot Start OneShot2D", category: "Gadgets_AdrenalineShot", kind: "oneshot", dim: "2d", windowMs: 2790, lengthText: "1.8s", lengthKey: "sxl18", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_Start_OneShot2D, key: "sxa76", catKey: "sxg10" },
{ name: "SFX_Gadgets_AdrenalineShot_Start_OneShot3D", display: "AdrenalineShot Start OneShot3D", category: "Gadgets_AdrenalineShot", kind: "oneshot", dim: "3d", windowMs: 2640, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_Start_OneShot3D, key: "sxa77", catKey: "sxg10" },
{ name: "SFX_Gadgets_AdrenalineShot_Stop_Early_OneShot2D", display: "AdrenalineShot Stop Early OneShot2D", category: "Gadgets_AdrenalineShot", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_Stop_Early_OneShot2D, key: "sxa78", catKey: "sxg10" },
{ name: "SFX_Gadgets_AdrenalineShot_Stop_Early_OneShot3D", display: "AdrenalineShot Stop Early OneShot3D", category: "Gadgets_AdrenalineShot", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_Stop_Early_OneShot3D, key: "sxa79", catKey: "sxg10" },
{ name: "SFX_Gadgets_AdrenalineShot_Stop_OneShot2D", display: "AdrenalineShot Stop OneShot2D", category: "Gadgets_AdrenalineShot", kind: "oneshot", dim: "2d", windowMs: 2970, lengthText: "2.0s", lengthKey: "sxl20", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_Stop_OneShot2D, key: "sxa80", catKey: "sxg10" },
{ name: "SFX_Gadgets_AdrenalineShot_Stop_OneShot3D", display: "AdrenalineShot Stop OneShot3D", category: "Gadgets_AdrenalineShot", kind: "oneshot", dim: "3d", windowMs: 2950, lengthText: "2.0s", lengthKey: "sxl20", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_AdrenalineShot_Stop_OneShot3D, key: "sxa81", catKey: "sxg10" },
{ name: "SFX_Gadgets_ATMine_Bounce_Soft_OneShot3D", display: "ATMine Bounce Soft OneShot3D", category: "Gadgets_ATMine", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_ATMine_Bounce_Soft_OneShot3D, key: "sxa82", catKey: "sxg11" },
{ name: "SFX_Gadgets_ATMine_Equip_OneShot2D", display: "ATMine Equip OneShot2D", category: "Gadgets_ATMine", kind: "oneshot", dim: "2d", windowMs: 2590, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_ATMine_Equip_OneShot2D, key: "sxa83", catKey: "sxg11" },
{ name: "SFX_Gadgets_ATMine_Equip_OneShot3D", display: "ATMine Equip OneShot3D", category: "Gadgets_ATMine", kind: "oneshot", dim: "3d", windowMs: 2700, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_ATMine_Equip_OneShot3D, key: "sxa84", catKey: "sxg11" },
{ name: "SFX_Gadgets_ATMine_Pickup_OneShot2D", display: "ATMine Pickup OneShot2D", category: "Gadgets_ATMine", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_ATMine_Pickup_OneShot2D, key: "sxa85", catKey: "sxg11" },
{ name: "SFX_Gadgets_ATMine_Pickup_OneShot3D", display: "ATMine Pickup OneShot3D", category: "Gadgets_ATMine", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_ATMine_Pickup_OneShot3D, key: "sxa86", catKey: "sxg11" },
{ name: "SFX_Gadgets_ATMine_UnEquip_OneShot2D", display: "ATMine UnEquip OneShot2D", category: "Gadgets_ATMine", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_ATMine_UnEquip_OneShot2D, key: "sxa87", catKey: "sxg11" },
{ name: "SFX_Gadgets_ATMine_UnEquip_OneShot3D", display: "ATMine UnEquip OneShot3D", category: "Gadgets_ATMine", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_ATMine_UnEquip_OneShot3D, key: "sxa88", catKey: "sxg11" },
{ name: "SFX_Gadgets_C4_Activate_OneShot2D", display: "C4 Activate OneShot2D", category: "Gadgets_C4", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_C4_Activate_OneShot2D, key: "sxa89", catKey: "sxg12" },
{ name: "SFX_Gadgets_C4_Activate_OneShot3D", display: "C4 Activate OneShot3D", category: "Gadgets_C4", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_C4_Activate_OneShot3D, key: "sxa90", catKey: "sxg12" },
{ name: "SFX_Gadgets_C4_Deploy_OneShot2D", display: "C4 Deploy OneShot2D", category: "Gadgets_C4", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_C4_Deploy_OneShot2D, key: "sxa91", catKey: "sxg12" },
{ name: "SFX_Gadgets_C4_Deploy_OneShot3D", display: "C4 Deploy OneShot3D", category: "Gadgets_C4", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_C4_Deploy_OneShot3D, key: "sxa92", catKey: "sxg12" },
{ name: "SFX_Gadgets_C4_Spawnable_Pickup_OneShot3D", display: "C4 Spawnable Pickup OneShot3D", category: "Gadgets_C4", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_C4_Spawnable_Pickup_OneShot3D, key: "sxa93", catKey: "sxg12" },
{ name: "SFX_Gadgets_C4_Spawnable_Spawn_OneShot3D", display: "C4 Spawnable Spawn OneShot3D", category: "Gadgets_C4", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_C4_Spawnable_Spawn_OneShot3D, key: "sxa94", catKey: "sxg12" },
{ name: "SFX_Gadgets_C4_Throw_OneShot2D", display: "C4 Throw OneShot2D", category: "Gadgets_C4", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_C4_Throw_OneShot2D, key: "sxa95", catKey: "sxg12" },
{ name: "SFX_Gadgets_C4_Throw_OneShot3D", display: "C4 Throw OneShot3D", category: "Gadgets_C4", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_C4_Throw_OneShot3D, key: "sxa96", catKey: "sxg12" },
{ name: "SFX_Gadgets_C4_Undeploy_OneShot2D", display: "C4 Undeploy OneShot2D", category: "Gadgets_C4", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_C4_Undeploy_OneShot2D, key: "sxa97", catKey: "sxg12" },
{ name: "SFX_Gadgets_C4_Undeploy_OneShot3D", display: "C4 Undeploy OneShot3D", category: "Gadgets_C4", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_C4_Undeploy_OneShot3D, key: "sxa98", catKey: "sxg12" },
{ name: "SFX_Gadgets_ConcussionGrenade_ConcussionLoop_SimpleLoop2D", display: "ConcussionGrenade ConcussionLoop SimpleLoop2D", category: "Gadgets_ConcussionGrenade", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_ConcussionGrenade_ConcussionLoop_SimpleLoop2D, key: "sxa99", catKey: "sxg13" },
{ name: "SFX_Gadgets_ConcussionGrenade_ConcussionStart_OneShot2D", display: "ConcussionGrenade ConcussionStart OneShot2D", category: "Gadgets_ConcussionGrenade", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_ConcussionGrenade_ConcussionStart_OneShot2D, key: "sxa100", catKey: "sxg13" },
{ name: "SFX_Gadgets_Decoy_WeaponFireVar01_OneShot3D", display: "Decoy WeaponFireVar01 OneShot3D", category: "Gadgets_Decoy", kind: "oneshot", dim: "3d", windowMs: 3020, lengthText: "2.0s", lengthKey: "sxl20", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Decoy_WeaponFireVar01_OneShot3D, key: "sxa101", catKey: "sxg14" },
{ name: "SFX_Gadgets_Decoy_WeaponFireVar02_OneShot3D", display: "Decoy WeaponFireVar02 OneShot3D", category: "Gadgets_Decoy", kind: "oneshot", dim: "3d", windowMs: 4760, lengthText: "3.8s", lengthKey: "sxl38", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Decoy_WeaponFireVar02_OneShot3D, key: "sxa102", catKey: "sxg14" },
{ name: "SFX_Gadgets_Decoy_WeaponFireVar03_OneShot3D", display: "Decoy WeaponFireVar03 OneShot3D", category: "Gadgets_Decoy", kind: "oneshot", dim: "3d", windowMs: 3890, lengthText: "2.9s", lengthKey: "sxl29", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Decoy_WeaponFireVar03_OneShot3D, key: "sxa103", catKey: "sxg14" },
{ name: "SFX_Gadgets_Decoy_WeaponFireVar04_OneShot3D", display: "Decoy WeaponFireVar04 OneShot3D", category: "Gadgets_Decoy", kind: "oneshot", dim: "3d", windowMs: 4000, lengthText: "3.0s", lengthKey: "sxl30", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Decoy_WeaponFireVar04_OneShot3D, key: "sxa104", catKey: "sxg14" },
{ name: "SFX_Gadgets_Decoy_WeaponFireVar05_OneShot3D", display: "Decoy WeaponFireVar05 OneShot3D", category: "Gadgets_Decoy", kind: "oneshot", dim: "3d", windowMs: 4370, lengthText: "3.4s", lengthKey: "sxl34", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Decoy_WeaponFireVar05_OneShot3D, key: "sxa105", catKey: "sxg14" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_Charge_OneShot2D", display: "Defibrillator Equipped Charge OneShot2D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "2d", windowMs: 5420, lengthText: "4.4s", lengthKey: "sxl44", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_Charge_OneShot2D, key: "sxa106", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_Charge_OneShot3D", display: "Defibrillator Equipped Charge OneShot3D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "3d", windowMs: 5390, lengthText: "4.4s", lengthKey: "sxl44", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_Charge_OneShot3D, key: "sxa107", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_Charged_OneShot2D", display: "Defibrillator Equipped Charged OneShot2D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_Charged_OneShot2D, key: "sxa108", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_Charged_OneShot3D", display: "Defibrillator Equipped Charged OneShot3D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_Charged_OneShot3D, key: "sxa109", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_ChargeHum_OneShot2D", display: "Defibrillator Equipped ChargeHum OneShot2D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "2d", windowMs: 3830, lengthText: "2.8s", lengthKey: "sxl28", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_ChargeHum_OneShot2D, key: "sxa110", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_ChargeHum_OneShot3D", display: "Defibrillator Equipped ChargeHum OneShot3D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "3d", windowMs: 3790, lengthText: "2.8s", lengthKey: "sxl28", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_ChargeHum_OneShot3D, key: "sxa111", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_ChargeRub_OneShot2D", display: "Defibrillator Equipped ChargeRub OneShot2D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_ChargeRub_OneShot2D, key: "sxa112", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_ChargeRub_OneShot3D", display: "Defibrillator Equipped ChargeRub OneShot3D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_ChargeRub_OneShot3D, key: "sxa113", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_Deploy_OneShot2D", display: "Defibrillator Equipped Deploy OneShot2D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_Deploy_OneShot2D, key: "sxa114", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_Deploy_OneShot3D", display: "Defibrillator Equipped Deploy OneShot3D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_Deploy_OneShot3D, key: "sxa115", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_Fire_Miss_OneShot2D", display: "Defibrillator Equipped Fire Miss OneShot2D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_Fire_Miss_OneShot2D, key: "sxa116", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_Fire_Miss_OneShot3D", display: "Defibrillator Equipped Fire Miss OneShot3D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_Fire_Miss_OneShot3D, key: "sxa117", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_Fire_OneShot2D", display: "Defibrillator Equipped Fire OneShot2D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_Fire_OneShot2D, key: "sxa118", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_Fire_OneShot3D", display: "Defibrillator Equipped Fire OneShot3D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_Fire_OneShot3D, key: "sxa119", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_Revive_Hit_OneShot3D", display: "Defibrillator Equipped Revive Hit OneShot3D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_Revive_Hit_OneShot3D, key: "sxa120", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_Undeploy_OneShot2D", display: "Defibrillator Equipped Undeploy OneShot2D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_Undeploy_OneShot2D, key: "sxa121", catKey: "sxg15" },
{ name: "SFX_Gadgets_Defibrillator_Equipped_Undeploy_OneShot3D", display: "Defibrillator Equipped Undeploy OneShot3D", category: "Gadgets_Defibrillator", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Defibrillator_Equipped_Undeploy_OneShot3D, key: "sxa122", catKey: "sxg15" },
{ name: "SFX_Gadgets_DeployableCover_Damage_OneShot3D", display: "DeployableCover Damage OneShot3D", category: "Gadgets_DeployableCover", kind: "oneshot", dim: "3d", windowMs: 2710, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_DeployableCover_Damage_OneShot3D, key: "sxa123", catKey: "sxg16" },
{ name: "SFX_Gadgets_DeployableCover_Deploy_OneShot2D", display: "DeployableCover Deploy OneShot2D", category: "Gadgets_DeployableCover", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_DeployableCover_Deploy_OneShot2D, key: "sxa124", catKey: "sxg16" },
{ name: "SFX_Gadgets_DeployableCover_Deploy_OneShot3D", display: "DeployableCover Deploy OneShot3D", category: "Gadgets_DeployableCover", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_DeployableCover_Deploy_OneShot3D, key: "sxa125", catKey: "sxg16" },
{ name: "SFX_Gadgets_DeployableCover_Destruction_OneShot3D", display: "DeployableCover Destruction OneShot3D", category: "Gadgets_DeployableCover", kind: "oneshot", dim: "3d", windowMs: 4310, lengthText: "3.3s", lengthKey: "sxl33", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_DeployableCover_Destruction_OneShot3D, key: "sxa126", catKey: "sxg16" },
{ name: "SFX_Gadgets_DeployableCover_Pickup_OneShot3D", display: "DeployableCover Pickup OneShot3D", category: "Gadgets_DeployableCover", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_DeployableCover_Pickup_OneShot3D, key: "sxa127", catKey: "sxg16" },
{ name: "SFX_Gadgets_DeployableCover_Place_OneShot3D", display: "DeployableCover Place OneShot3D", category: "Gadgets_DeployableCover", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_DeployableCover_Place_OneShot3D, key: "sxa128", catKey: "sxg16" },
{ name: "SFX_Gadgets_DeployableCover_Throw_OneShot2D", display: "DeployableCover Throw OneShot2D", category: "Gadgets_DeployableCover", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_DeployableCover_Throw_OneShot2D, key: "sxa129", catKey: "sxg16" },
{ name: "SFX_Gadgets_DeployableCover_Throw_OneShot3D", display: "DeployableCover Throw OneShot3D", category: "Gadgets_DeployableCover", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_DeployableCover_Throw_OneShot3D, key: "sxa130", catKey: "sxg16" },
{ name: "SFX_Gadgets_DeployableCover_Undeploy_OneShot2D", display: "DeployableCover Undeploy OneShot2D", category: "Gadgets_DeployableCover", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_DeployableCover_Undeploy_OneShot2D, key: "sxa131", catKey: "sxg16" },
{ name: "SFX_Gadgets_DeployableCover_Undeploy_OneShot3D", display: "DeployableCover Undeploy OneShot3D", category: "Gadgets_DeployableCover", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_DeployableCover_Undeploy_OneShot3D, key: "sxa132", catKey: "sxg16" },
{ name: "SFX_Gadgets_Drone_Spawnable_Fire_OneShot3D", display: "Drone Spawnable Fire OneShot3D", category: "Gadgets_Drone", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Drone_Spawnable_Fire_OneShot3D, key: "sxa133", catKey: "sxg17" },
{ name: "SFX_Gadgets_Drone_Spawnable_TargetLockInProgress_OneShot2D", display: "Drone Spawnable TargetLockInProgress OneShot2D", category: "Gadgets_Drone", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Drone_Spawnable_TargetLockInProgress_OneShot2D, key: "sxa134", catKey: "sxg17" },
{ name: "SFX_Gadgets_Drone_Spawnable_TargetLockReady_OneShot2D", display: "Drone Spawnable TargetLockReady OneShot2D", category: "Gadgets_Drone", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Drone_Spawnable_TargetLockReady_OneShot2D, key: "sxa135", catKey: "sxg17" },
{ name: "SFX_Gadgets_Drone_Switchblade_Engine_Propellar_OneShot3D", display: "Drone Switchblade Engine Propellar OneShot3D", category: "Gadgets_Drone", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Drone_Switchblade_Engine_Propellar_OneShot3D, key: "sxa136", catKey: "sxg17" },
{ name: "SFX_Gadgets_Drone_Switchblade_HiFi_Fire_Wings_OneShot2D", display: "Drone Switchblade HiFi Fire Wings OneShot2D", category: "Gadgets_Drone", kind: "oneshot", dim: "2d", windowMs: 3510, lengthText: "2.5s", lengthKey: "sxl25", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Drone_Switchblade_HiFi_Fire_Wings_OneShot2D, key: "sxa137", catKey: "sxg17" },
{ name: "SFX_Gadgets_Drone_Switchblade_HiFi_Fire_Wings_OneShot3D", display: "Drone Switchblade HiFi Fire Wings OneShot3D", category: "Gadgets_Drone", kind: "oneshot", dim: "3d", windowMs: 3670, lengthText: "2.7s", lengthKey: "sxl27", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Drone_Switchblade_HiFi_Fire_Wings_OneShot3D, key: "sxa138", catKey: "sxg17" },
{ name: "SFX_Gadgets_EIDOS_Disabled_OneShot3D", display: "EIDOS Disabled OneShot3D", category: "Gadgets_EIDOS", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EIDOS_Disabled_OneShot3D, key: "sxa139", catKey: "sxg18" },
{ name: "SFX_Gadgets_EIDOS_Enable_OneShot3D", display: "EIDOS Enable OneShot3D", category: "Gadgets_EIDOS", kind: "oneshot", dim: "3d", windowMs: 3280, lengthText: "2.3s", lengthKey: "sxl23", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EIDOS_Enable_OneShot3D, key: "sxa140", catKey: "sxg18" },
{ name: "SFX_Gadgets_EIDOS_Equip_OneShot2D", display: "EIDOS Equip OneShot2D", category: "Gadgets_EIDOS", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EIDOS_Equip_OneShot2D, key: "sxa141", catKey: "sxg18" },
{ name: "SFX_Gadgets_EIDOS_Equip_OneShot3D", display: "EIDOS Equip OneShot3D", category: "Gadgets_EIDOS", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EIDOS_Equip_OneShot3D, key: "sxa142", catKey: "sxg18" },
{ name: "SFX_Gadgets_EIDOS_Fire_OneShot3D", display: "EIDOS Fire OneShot3D", category: "Gadgets_EIDOS", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EIDOS_Fire_OneShot3D, key: "sxa143", catKey: "sxg18" },
{ name: "SFX_Gadgets_EIDOS_Idle_SimpleLoop3D", display: "EIDOS Idle SimpleLoop3D", category: "Gadgets_EIDOS", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EIDOS_Idle_SimpleLoop3D, key: "sxa144", catKey: "sxg18" },
{ name: "SFX_Gadgets_EIDOS_Pickup_OneShot3D", display: "EIDOS Pickup OneShot3D", category: "Gadgets_EIDOS", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EIDOS_Pickup_OneShot3D, key: "sxa145", catKey: "sxg18" },
{ name: "SFX_Gadgets_EIDOS_Place_OneShot2D", display: "EIDOS Place OneShot2D", category: "Gadgets_EIDOS", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EIDOS_Place_OneShot2D, key: "sxa146", catKey: "sxg18" },
{ name: "SFX_Gadgets_EIDOS_Place_OneShot3D", display: "EIDOS Place OneShot3D", category: "Gadgets_EIDOS", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EIDOS_Place_OneShot3D, key: "sxa147", catKey: "sxg18" },
{ name: "SFX_Gadgets_EoDBot_Spawnable_Arm_Horizontal_OneShot3D", display: "EoDBot Spawnable Arm Horizontal OneShot3D", category: "Gadgets_EoDBot", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EoDBot_Spawnable_Arm_Horizontal_OneShot3D, key: "sxa148", catKey: "sxg19" },
{ name: "SFX_Gadgets_EoDBot_Spawnable_Arm_Vertical_OneShot3D", display: "EoDBot Spawnable Arm Vertical OneShot3D", category: "Gadgets_EoDBot", kind: "oneshot", dim: "3d", windowMs: 2980, lengthText: "2.0s", lengthKey: "sxl20", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EoDBot_Spawnable_Arm_Vertical_OneShot3D, key: "sxa149", catKey: "sxg19" },
{ name: "SFX_Gadgets_EoDBot_Spawnable_Chassis_Rattle_OneShot3D", display: "EoDBot Spawnable Chassis Rattle OneShot3D", category: "Gadgets_EoDBot", kind: "oneshot", dim: "3d", windowMs: 8440, lengthText: "7.4s", lengthKey: "sxl74", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EoDBot_Spawnable_Chassis_Rattle_OneShot3D, key: "sxa150", catKey: "sxg19" },
{ name: "SFX_Gadgets_EoDBot_Spawnable_Deploy_OneShot2D", display: "EoDBot Spawnable Deploy OneShot2D", category: "Gadgets_EoDBot", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EoDBot_Spawnable_Deploy_OneShot2D, key: "sxa151", catKey: "sxg19" },
{ name: "SFX_Gadgets_EoDBot_Spawnable_Deploy_OneShot3D", display: "EoDBot Spawnable Deploy OneShot3D", category: "Gadgets_EoDBot", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EoDBot_Spawnable_Deploy_OneShot3D, key: "sxa152", catKey: "sxg19" },
{ name: "SFX_Gadgets_EoDBot_Spawnable_Engine_OneShot3D", display: "EoDBot Spawnable Engine OneShot3D", category: "Gadgets_EoDBot", kind: "oneshot", dim: "3d", windowMs: 5610, lengthText: "4.6s", lengthKey: "sxl46", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EoDBot_Spawnable_Engine_OneShot3D, key: "sxa153", catKey: "sxg19" },
{ name: "SFX_Gadgets_EoDBot_Spawnable_Idle_OneShot3D", display: "EoDBot Spawnable Idle OneShot3D", category: "Gadgets_EoDBot", kind: "oneshot", dim: "3d", windowMs: 4960, lengthText: "4.0s", lengthKey: "sxl40", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EoDBot_Spawnable_Idle_OneShot3D, key: "sxa154", catKey: "sxg19" },
{ name: "SFX_Gadgets_EoDBot_Spawnable_MineFire_OneShot3D", display: "EoDBot Spawnable MineFire OneShot3D", category: "Gadgets_EoDBot", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EoDBot_Spawnable_MineFire_OneShot3D, key: "sxa155", catKey: "sxg19" },
{ name: "SFX_Gadgets_EoDBot_Spawnable_Start_Idle_OneShot3D", display: "EoDBot Spawnable Start Idle OneShot3D", category: "Gadgets_EoDBot", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EoDBot_Spawnable_Start_Idle_OneShot3D, key: "sxa156", catKey: "sxg19" },
{ name: "SFX_Gadgets_EoDBot_Spawnable_Stop_Idle_OneShot3D", display: "EoDBot Spawnable Stop Idle OneShot3D", category: "Gadgets_EoDBot", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EoDBot_Spawnable_Stop_Idle_OneShot3D, key: "sxa157", catKey: "sxg19" },
{ name: "SFX_Gadgets_EpiPen_Charge_OneShot2D", display: "EpiPen Charge OneShot2D", category: "Gadgets_EpiPen", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EpiPen_Charge_OneShot2D, key: "sxa158", catKey: "sxg20" },
{ name: "SFX_Gadgets_EpiPen_Charge_OneShot3D", display: "EpiPen Charge OneShot3D", category: "Gadgets_EpiPen", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EpiPen_Charge_OneShot3D, key: "sxa159", catKey: "sxg20" },
{ name: "SFX_Gadgets_EpiPen_Flip_OneShot2D", display: "EpiPen Flip OneShot2D", category: "Gadgets_EpiPen", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EpiPen_Flip_OneShot2D, key: "sxa160", catKey: "sxg20" },
{ name: "SFX_Gadgets_EpiPen_Flip_OneShot3D", display: "EpiPen Flip OneShot3D", category: "Gadgets_EpiPen", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EpiPen_Flip_OneShot3D, key: "sxa161", catKey: "sxg20" },
{ name: "SFX_Gadgets_EpiPen_HalfWay_OneShot2D", display: "EpiPen HalfWay OneShot2D", category: "Gadgets_EpiPen", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EpiPen_HalfWay_OneShot2D, key: "sxa162", catKey: "sxg20" },
{ name: "SFX_Gadgets_EpiPen_HalfWay_OneShot3D", display: "EpiPen HalfWay OneShot3D", category: "Gadgets_EpiPen", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EpiPen_HalfWay_OneShot3D, key: "sxa163", catKey: "sxg20" },
{ name: "SFX_Gadgets_EpiPen_Injection_OneShot2D", display: "EpiPen Injection OneShot2D", category: "Gadgets_EpiPen", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EpiPen_Injection_OneShot2D, key: "sxa164", catKey: "sxg20" },
{ name: "SFX_Gadgets_EpiPen_Injection_OneShot3D", display: "EpiPen Injection OneShot3D", category: "Gadgets_EpiPen", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EpiPen_Injection_OneShot3D, key: "sxa165", catKey: "sxg20" },
{ name: "SFX_Gadgets_EpiPen_ReviveDone_1p_OneShot2D", display: "EpiPen ReviveDone 1p OneShot2D", category: "Gadgets_EpiPen", kind: "oneshot", dim: "2d", windowMs: 3190, lengthText: "2.2s", lengthKey: "sxl22", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EpiPen_ReviveDone_1p_OneShot2D, key: "sxa166", catKey: "sxg20" },
{ name: "SFX_Gadgets_EpiPen_Undeploy_OneShot2D", display: "EpiPen Undeploy OneShot2D", category: "Gadgets_EpiPen", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EpiPen_Undeploy_OneShot2D, key: "sxa167", catKey: "sxg20" },
{ name: "SFX_Gadgets_EpiPen_Undeploy_OneShot3D", display: "EpiPen Undeploy OneShot3D", category: "Gadgets_EpiPen", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_EpiPen_Undeploy_OneShot3D, key: "sxa168", catKey: "sxg20" },
{ name: "SFX_Gadgets_Flashbang_FlashbangLoop_OneShot2D", display: "Flashbang FlashbangLoop OneShot2D", category: "Gadgets_Flashbang", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Flashbang_FlashbangLoop_OneShot2D, key: "sxa169", catKey: "sxg21" },
{ name: "SFX_Gadgets_Flashbang_FlashbangStart_OneShot2D", display: "Flashbang FlashbangStart OneShot2D", category: "Gadgets_Flashbang", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_Flashbang_FlashbangStart_OneShot2D, key: "sxa170", catKey: "sxg21" },
{ name: "SFX_Gadgets_SupplyDrop_CrateExplode_3D", display: "SupplyDrop CrateExplode 3D", category: "Gadgets_SupplyDrop", kind: "oneshot", dim: "3d", windowMs: 3500, lengthText: "2.5s", lengthKey: "sxl25", asset: mod.RuntimeSpawn_Common.SFX_Gadgets_SupplyDrop_CrateExplode_3D, key: "sxa171", catKey: "sxg22" },
{ name: "SFX_GameModes_BR_Circle_Appear_OneShot2D", display: "BR Circle Appear OneShot2D", category: "GameModes_BR", kind: "oneshot", dim: "2d", windowMs: 3000, lengthText: "2.0s", lengthKey: "sxl20", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Appear_OneShot2D, key: "sxa172", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Boundary_SimpleLoop2D", display: "BR Circle Boundary SimpleLoop2D", category: "GameModes_BR", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Boundary_SimpleLoop2D, key: "sxa173", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Damage_OneShot2D", display: "BR Circle Damage OneShot2D", category: "GameModes_BR", kind: "oneshot", dim: "2d", windowMs: 4180, lengthText: "3.2s", lengthKey: "sxl32", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Damage_OneShot2D, key: "sxa174", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Damage_OneShot3D", display: "BR Circle Damage OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 4180, lengthText: "3.2s", lengthKey: "sxl32", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Damage_OneShot3D, key: "sxa175", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_DamageStart_Loop2D", display: "BR Circle DamageStart Loop2D", category: "GameModes_BR", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_DamageStart_Loop2D, key: "sxa176", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_DamageStart_Loop3D", display: "BR Circle DamageStart Loop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_DamageStart_Loop3D, key: "sxa177", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_DamageStop_Loop2D", display: "BR Circle DamageStop Loop2D", category: "GameModes_BR", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_DamageStop_Loop2D, key: "sxa178", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_DamageStop_Loop3D", display: "BR Circle DamageStop Loop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_DamageStop_Loop3D, key: "sxa179", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_DeathWarning_SimpleLoop2D", display: "BR Circle DeathWarning SimpleLoop2D", category: "GameModes_BR", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_DeathWarning_SimpleLoop2D, key: "sxa180", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_DeathWarning_SimpleLoop3D", display: "BR Circle DeathWarning SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_DeathWarning_SimpleLoop3D, key: "sxa181", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Debris_OneShot3D", display: "BR Circle Debris OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 4980, lengthText: "4.0s", lengthKey: "sxl40", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Debris_OneShot3D, key: "sxa182", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Fire_Close_SimpleLoop3D", display: "BR Circle Fire Close SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Fire_Close_SimpleLoop3D, key: "sxa183", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Fire_Distant_High_SimpleLoop3D", display: "BR Circle Fire Distant High SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Fire_Distant_High_SimpleLoop3D, key: "sxa184", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Fire_Distant_SimpleLoop3D", display: "BR Circle Fire Distant SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Fire_Distant_SimpleLoop3D, key: "sxa185", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Fire_Embers_SimpleLoop3D", display: "BR Circle Fire Embers SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Fire_Embers_SimpleLoop3D, key: "sxa186", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Fire_High_SimpleLoop3D", display: "BR Circle Fire High SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Fire_High_SimpleLoop3D, key: "sxa187", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Fire_Mid_Distant_SimpleLoop3D", display: "BR Circle Fire Mid Distant SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Fire_Mid_Distant_SimpleLoop3D, key: "sxa188", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Fire_Perimeter_SimpleLoop3D", display: "BR Circle Fire Perimeter SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Fire_Perimeter_SimpleLoop3D, key: "sxa189", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Fire_Phase_SimpleLoop3D", display: "BR Circle Fire Phase SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Fire_Phase_SimpleLoop3D, key: "sxa190", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Fire_VeryHigh_SimpleLoop3D", display: "BR Circle Fire VeryHigh SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Fire_VeryHigh_SimpleLoop3D, key: "sxa191", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Fire_Wide_SimpleLoop3D", display: "BR Circle Fire Wide SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Fire_Wide_SimpleLoop3D, key: "sxa192", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_FlareUp_OneShot3D", display: "BR Circle FlareUp OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 4290, lengthText: "3.3s", lengthKey: "sxl33", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_FlareUp_OneShot3D, key: "sxa193", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Circle_Wind_OneShot3D", display: "BR Circle Wind OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 4140, lengthText: "3.1s", lengthKey: "sxl31", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Circle_Wind_OneShot3D, key: "sxa194", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_MidroundRespawn_RespawnTower_Capture_OneShot2D", display: "BR MidroundRespawn RespawnTower Capture OneShot2D", category: "GameModes_BR", kind: "oneshot", dim: "2d", windowMs: 14990, lengthText: "10s+", lengthKey: "sxl10p", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_MidroundRespawn_RespawnTower_Capture_OneShot2D, key: "sxa195", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_MidroundRespawn_RespawnTower_PanelReset_OneShot2D", display: "BR MidroundRespawn RespawnTower PanelReset OneShot2D", category: "GameModes_BR", kind: "oneshot", dim: "2d", windowMs: 15000, lengthText: "10s+", lengthKey: "sxl10p", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_MidroundRespawn_RespawnTower_PanelReset_OneShot2D, key: "sxa196", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_MidroundRespawn_RespawnTower_Stow_OneShot2D", display: "BR MidroundRespawn RespawnTower Stow OneShot2D", category: "GameModes_BR", kind: "oneshot", dim: "2d", windowMs: 15000, lengthText: "10s+", lengthKey: "sxl10p", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_MidroundRespawn_RespawnTower_Stow_OneShot2D, key: "sxa197", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_CTF_DataDrive_Insert_OneShot3D", display: "BR Mission CTF DataDrive Insert OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_CTF_DataDrive_Insert_OneShot3D, key: "sxa198", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_CTF_Download_OneShot3D", display: "BR Mission CTF Download OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 14990, lengthText: "10s+", lengthKey: "sxl10p", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_CTF_Download_OneShot3D, key: "sxa199", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_CTF_DriveCarrierTracking_OneShot3D", display: "BR Mission CTF DriveCarrierTracking OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_CTF_DriveCarrierTracking_OneShot3D, key: "sxa200", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_DataExtraction_DataCase_PickUp_OneShot3D", display: "BR Mission DataExtraction DataCase PickUp OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_DataExtraction_DataCase_PickUp_OneShot3D, key: "sxa201", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_DemoCrew_Alarm_Close_SimpleLoop3D", display: "BR Mission DemoCrew Alarm Close SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_DemoCrew_Alarm_Close_SimpleLoop3D, key: "sxa202", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_DemoCrew_Alarm_Distant_SimpleLoop3D", display: "BR Mission DemoCrew Alarm Distant SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_DemoCrew_Alarm_Distant_SimpleLoop3D, key: "sxa203", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_DemoCrew_BombPickUp_OneShot3D", display: "BR Mission DemoCrew BombPickUp OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_DemoCrew_BombPickUp_OneShot3D, key: "sxa204", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_DemoCrew_BombPlace_OneShot3D", display: "BR Mission DemoCrew BombPlace OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_DemoCrew_BombPlace_OneShot3D, key: "sxa205", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_DemoCrewAlarmClose_SimpleLoop_3D", display: "BR Mission DemoCrewAlarmClose SimpleLoop 3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_DemoCrewAlarmClose_SimpleLoop_3D, key: "sxa206", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_RetrievalBeaconBeep_OneShot3D", display: "BR Mission RetrievalBeaconBeep OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_RetrievalBeaconBeep_OneShot3D, key: "sxa207", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_WeaponCache_BoltCutter_Pickup_OneShot3D", display: "BR Mission WeaponCache BoltCutter Pickup OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_WeaponCache_BoltCutter_Pickup_OneShot3D, key: "sxa208", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_WeaponCache_Open_OneShot3D", display: "BR Mission WeaponCache Open OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 5510, lengthText: "4.5s", lengthKey: "sxl45", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_WeaponCache_Open_OneShot3D, key: "sxa209", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_Wreckage_BombBeeping_Loop_SimpleLoop3D", display: "BR Mission Wreckage BombBeeping Loop SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_Wreckage_BombBeeping_Loop_SimpleLoop3D, key: "sxa210", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_Wreckage_BombBeeping_OneShot3D", display: "BR Mission Wreckage BombBeeping OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_Wreckage_BombBeeping_OneShot3D, key: "sxa211", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_Mission_Wreckage_ComputerAlarm_SimpleLoop3D", display: "BR Mission Wreckage ComputerAlarm SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_Mission_Wreckage_ComputerAlarm_SimpleLoop3D, key: "sxa212", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_RespawnTower_Activate_Alarm_SimpleLoop3D", display: "BR RespawnTower Activate Alarm SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_RespawnTower_Activate_Alarm_SimpleLoop3D, key: "sxa213", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_RespawnTower_Activate_Close_OneShot3D", display: "BR RespawnTower Activate Close OneShot3D", category: "GameModes_BR", kind: "oneshot", dim: "3d", windowMs: 4650, lengthText: "3.7s", lengthKey: "sxl37", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_RespawnTower_Activate_Close_OneShot3D, key: "sxa214", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_RespawnTower_Activate_Distant_SimpleLoop3D", display: "BR RespawnTower Activate Distant SimpleLoop3D", category: "GameModes_BR", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_RespawnTower_Activate_Distant_SimpleLoop3D, key: "sxa215", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_UXUI_CircleShrink_Start_OneShot2D", display: "BR UXUI CircleShrink Start OneShot2D", category: "GameModes_BR", kind: "oneshot", dim: "2d", windowMs: 4150, lengthText: "3.2s", lengthKey: "sxl32", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_UXUI_CircleShrink_Start_OneShot2D, key: "sxa216", catKey: "sxg23" },
{ name: "SFX_GameModes_BR_UXUI_CIrcleShrink_Stop_OneShot2D", display: "BR UXUI CIrcleShrink Stop OneShot2D", category: "GameModes_BR", kind: "oneshot", dim: "2d", windowMs: 3130, lengthText: "2.1s", lengthKey: "sxl21", asset: mod.RuntimeSpawn_Common.SFX_GameModes_BR_UXUI_CIrcleShrink_Stop_OneShot2D, key: "sxa217", catKey: "sxg23" },
{ name: "SFX_GameModes_Gauntlet_Mission_Beacons_Beeping_SimpleLoop3D", display: "Gauntlet Mission Beacons Beeping SimpleLoop3D", category: "GameModes_Gauntlet", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Gauntlet_Mission_Beacons_Beeping_SimpleLoop3D, key: "sxa218", catKey: "sxg24" },
{ name: "SFX_GameModes_Gauntlet_Mission_Circuit_TerminalSpotLoop_SimpleLoop3D", display: "Gauntlet Mission Circuit TerminalSpotLoop SimpleLoop3D", category: "GameModes_Gauntlet", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Gauntlet_Mission_Circuit_TerminalSpotLoop_SimpleLoop3D, key: "sxa219", catKey: "sxg24" },
{ name: "SFX_GameModes_Gauntlet_Mission_Heist_AltCacheCarrierBeep_SimpleLoop3D", display: "Gauntlet Mission Heist AltCacheCarrierBeep SimpleLoop3D", category: "GameModes_Gauntlet", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Gauntlet_Mission_Heist_AltCacheCarrierBeep_SimpleLoop3D, key: "sxa220", catKey: "sxg24" },
{ name: "SFX_GameModes_Gauntlet_Mission_Heist_CacheBeep_SimpleLoop3D", display: "Gauntlet Mission Heist CacheBeep SimpleLoop3D", category: "GameModes_Gauntlet", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Gauntlet_Mission_Heist_CacheBeep_SimpleLoop3D, key: "sxa221", catKey: "sxg24" },
{ name: "SFX_GameModes_Gauntlet_Mission_Heist_PlayerPickupCache_OneShot3D", display: "Gauntlet Mission Heist PlayerPickupCache OneShot3D", category: "GameModes_Gauntlet", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Gauntlet_Mission_Heist_PlayerPickupCache_OneShot3D, key: "sxa222", catKey: "sxg24" },
{ name: "SFX_GameModes_Gauntlet_Mission_Wreckage_ActiveBombNearby_OneShot3D", display: "Gauntlet Mission Wreckage ActiveBombNearby OneShot3D", category: "GameModes_Gauntlet", kind: "oneshot", dim: "3d", windowMs: 2640, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Gauntlet_Mission_Wreckage_ActiveBombNearby_OneShot3D, key: "sxa223", catKey: "sxg24" },
{ name: "SFX_GameModes_Gauntlet_Mission_Wreckage_BombPickup3D_OneShot3D", display: "Gauntlet Mission Wreckage BombPickup3D OneShot3D", category: "GameModes_Gauntlet", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Gauntlet_Mission_Wreckage_BombPickup3D_OneShot3D, key: "sxa224", catKey: "sxg24" },
{ name: "SFX_GameModes_Gauntlet_Mission_Wreckage_KeyboardTyping_SimpleLoop3D", display: "Gauntlet Mission Wreckage KeyboardTyping SimpleLoop3D", category: "GameModes_Gauntlet", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Gauntlet_Mission_Wreckage_KeyboardTyping_SimpleLoop3D, key: "sxa225", catKey: "sxg24" },
{ name: "SFX_Gamemodes_Payload_Breacher_Decel_OneShot3D", display: "Payload Breacher Decel OneShot3D", category: "Gamemodes_Payload", kind: "oneshot", dim: "3d", windowMs: 2700, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_Gamemodes_Payload_Breacher_Decel_OneShot3D, key: "sxa226", catKey: "sxg25" },
{ name: "SFX_Gamemodes_Payload_Breacher_Exterior_Accel_SimpleLoop3D", display: "Payload Breacher Exterior Accel SimpleLoop3D", category: "Gamemodes_Payload", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Gamemodes_Payload_Breacher_Exterior_Accel_SimpleLoop3D, key: "sxa227", catKey: "sxg25" },
{ name: "SFX_Gamemodes_Payload_Breacher_Idle_SimpleLoop3D", display: "Payload Breacher Idle SimpleLoop3D", category: "Gamemodes_Payload", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Gamemodes_Payload_Breacher_Idle_SimpleLoop3D, key: "sxa228", catKey: "sxg25" },
{ name: "SFX_Gamemodes_Payload_Breacher_Tracks_SimpleLoop3D", display: "Payload Breacher Tracks SimpleLoop3D", category: "Gamemodes_Payload", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Gamemodes_Payload_Breacher_Tracks_SimpleLoop3D, key: "sxa229", catKey: "sxg25" },
{ name: "SFX_GameModes_Rush_Alarm_Leadout_SimpleLoop3D", display: "Rush Alarm Leadout SimpleLoop3D", category: "GameModes_Rush", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Rush_Alarm_Leadout_SimpleLoop3D, key: "sxa230", catKey: "sxg26" },
{ name: "SFX_GameModes_Rush_Alarm_SimpleLoop3D", display: "Rush Alarm SimpleLoop3D", category: "GameModes_Rush", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Rush_Alarm_SimpleLoop3D, key: "sxa231", catKey: "sxg26" },
{ name: "SFX_GameModes_Rush_Arm_SimpleLoop3D", display: "Rush Arm SimpleLoop3D", category: "GameModes_Rush", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Rush_Arm_SimpleLoop3D, key: "sxa232", catKey: "sxg26" },
{ name: "SFX_GameModes_Rush_Armed_OneShot3D", display: "Rush Armed OneShot3D", category: "GameModes_Rush", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Rush_Armed_OneShot3D, key: "sxa233", catKey: "sxg26" },
{ name: "SFX_GameModes_Rush_Defused_OneShot3D", display: "Rush Defused OneShot3D", category: "GameModes_Rush", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Rush_Defused_OneShot3D, key: "sxa234", catKey: "sxg26" },
{ name: "SFX_GameModes_Rush_Defusing_SimpleLoop3D", display: "Rush Defusing SimpleLoop3D", category: "GameModes_Rush", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Rush_Defusing_SimpleLoop3D, key: "sxa235", catKey: "sxg26" },
{ name: "SFX_GameModes_Rush_Telemetry_SimpleLoop3D", display: "Rush Telemetry SimpleLoop3D", category: "GameModes_Rush", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_GameModes_Rush_Telemetry_SimpleLoop3D, key: "sxa236", catKey: "sxg26" },
{ name: "SFX_Levels_Brooklyn_Shared_BigWorld_Birds_Falcons_OneShot3D", display: "Brooklyn Shared BigWorld Birds Falcons OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 2780, lengthText: "1.8s", lengthKey: "sxl18", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_BigWorld_Birds_Falcons_OneShot3D, key: "sxa237", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_BigWorld_Birds_Finches_OneShot3D", display: "Brooklyn Shared BigWorld Birds Finches OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_BigWorld_Birds_Finches_OneShot3D, key: "sxa238", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_BigWorld_Birds_Grebs_OneShot3D", display: "Brooklyn Shared BigWorld Birds Grebs OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 4360, lengthText: "3.4s", lengthKey: "sxl34", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_BigWorld_Birds_Grebs_OneShot3D, key: "sxa239", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_BigWorld_Birds_Pigeons_OneShot3D", display: "Brooklyn Shared BigWorld Birds Pigeons OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 2770, lengthText: "1.8s", lengthKey: "sxl18", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_BigWorld_Birds_Pigeons_OneShot3D, key: "sxa240", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_BigWorld_Birds_Swallows_OneShot3D", display: "Brooklyn Shared BigWorld Birds Swallows OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 3230, lengthText: "2.2s", lengthKey: "sxl22", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_BigWorld_Birds_Swallows_OneShot3D, key: "sxa241", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_BigWorld_BuildingGroan_OneShot3D", display: "Brooklyn Shared BigWorld BuildingGroan OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 15000, lengthText: "10s+", lengthKey: "sxl10p", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_BigWorld_BuildingGroan_OneShot3D, key: "sxa242", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_BigWorld_CarHorn_Angry_OneShot3D", display: "Brooklyn Shared BigWorld CarHorn Angry OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 3260, lengthText: "2.3s", lengthKey: "sxl23", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_BigWorld_CarHorn_Angry_OneShot3D, key: "sxa243", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_BigWorld_EmergSirensMisc_Far_OneShot3D", display: "Brooklyn Shared BigWorld EmergSirensMisc Far OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 10670, lengthText: "9.7s", lengthKey: "sxl97", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_BigWorld_EmergSirensMisc_Far_OneShot3D, key: "sxa244", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_BigWorld_EmergSirensMisc_Near_OneShot3D", display: "Brooklyn Shared BigWorld EmergSirensMisc Near OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 15000, lengthText: "10s+", lengthKey: "sxl10p", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_BigWorld_EmergSirensMisc_Near_OneShot3D, key: "sxa245", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_BigWorld_InteriorWoodCreak_OneShot3D", display: "Brooklyn Shared BigWorld InteriorWoodCreak OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_BigWorld_InteriorWoodCreak_OneShot3D, key: "sxa246", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_BigWorld_MouseSqueak_Urban_OneShot3D", display: "Brooklyn Shared BigWorld MouseSqueak Urban OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_BigWorld_MouseSqueak_Urban_OneShot3D, key: "sxa247", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_BigWorld_WoodDoorOpen_Distant_OneShot3D", display: "Brooklyn Shared BigWorld WoodDoorOpen Distant OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_BigWorld_WoodDoorOpen_Distant_OneShot3D, key: "sxa248", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_BigWorld_WoodDoorShut_Distant_OneShot3D", display: "Brooklyn Shared BigWorld WoodDoorShut Distant OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_BigWorld_WoodDoorShut_Distant_OneShot3D, key: "sxa249", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_AirDuct_SimpleLoop3D", display: "Brooklyn Shared Spots AirDuct SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_AirDuct_SimpleLoop3D, key: "sxa250", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_CarAlarm_SimpleLoop3D", display: "Brooklyn Shared Spots CarAlarm SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_CarAlarm_SimpleLoop3D, key: "sxa251", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_Fountain_Water_Head_SimpleLoop3D", display: "Brooklyn Shared Spots Fountain Water Head SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_Fountain_Water_Head_SimpleLoop3D, key: "sxa252", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_Fountain_Water_SimpleLoop3D", display: "Brooklyn Shared Spots Fountain Water SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_Fountain_Water_SimpleLoop3D, key: "sxa253", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_GarbageFlies_SimpleLoop3D", display: "Brooklyn Shared Spots GarbageFlies SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_GarbageFlies_SimpleLoop3D, key: "sxa254", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_HeavyMetalStress_SimpleLoop3D", display: "Brooklyn Shared Spots HeavyMetalStress SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_HeavyMetalStress_SimpleLoop3D, key: "sxa255", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_Hydrant_Burst_OneShot3D", display: "Brooklyn Shared Spots Hydrant Burst OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 5000, lengthText: "4.0s", lengthKey: "sxl40", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_Hydrant_Burst_OneShot3D, key: "sxa256", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_Hydrant_Ground_SimpleLoop3D", display: "Brooklyn Shared Spots Hydrant Ground SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_Hydrant_Ground_SimpleLoop3D, key: "sxa257", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_Hydrant_Splatter_SimpleLoop3D", display: "Brooklyn Shared Spots Hydrant Splatter SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_Hydrant_Splatter_SimpleLoop3D, key: "sxa258", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_Hydrant_Spray_SimpleLoop3D", display: "Brooklyn Shared Spots Hydrant Spray SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_Hydrant_Spray_SimpleLoop3D, key: "sxa259", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_MetalStress_OneShot3D", display: "Brooklyn Shared Spots MetalStress OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 3540, lengthText: "2.5s", lengthKey: "sxl25", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_MetalStress_OneShot3D, key: "sxa260", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_MiceFighting_SimpleLoop3D", display: "Brooklyn Shared Spots MiceFighting SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_MiceFighting_SimpleLoop3D, key: "sxa261", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_PaperSwirls_SimpleLoop3D", display: "Brooklyn Shared Spots PaperSwirls SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_PaperSwirls_SimpleLoop3D, key: "sxa262", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_PipeStress_SimpleLoop3D", display: "Brooklyn Shared Spots PipeStress SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_PipeStress_SimpleLoop3D, key: "sxa263", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_VariousBirds_SimpleLoop3D", display: "Brooklyn Shared Spots VariousBirds SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_VariousBirds_SimpleLoop3D, key: "sxa264", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_Water_Splash_SimpleLoop3D", display: "Brooklyn Shared Spots Water Splash SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_Water_Splash_SimpleLoop3D, key: "sxa265", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_WaterTrickle_Stone_SimpleLoop3D", display: "Brooklyn Shared Spots WaterTrickle Stone SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_WaterTrickle_Stone_SimpleLoop3D, key: "sxa266", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_WaterTrickle_Wood_SimpleLoop3D", display: "Brooklyn Shared Spots WaterTrickle Wood SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_WaterTrickle_Wood_SimpleLoop3D, key: "sxa267", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Shared_Spots_WindChime_SimpleLoop3D", display: "Brooklyn Shared Spots WindChime SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Shared_Spots_WindChime_SimpleLoop3D, key: "sxa268", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_SP_Attack_FX_SteamManhole_SimpleLoop3D", display: "Brooklyn SP Attack FX SteamManhole SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_SP_Attack_FX_SteamManhole_SimpleLoop3D, key: "sxa269", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_ACUnit_SimpleLoop3D", display: "Brooklyn Spots ACUnit SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_ACUnit_SimpleLoop3D, key: "sxa270", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_BridgeFire_L_SimpleLoop3D", display: "Brooklyn Spots BridgeFire L SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_BridgeFire_L_SimpleLoop3D, key: "sxa271", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_BridgeMovement_SimpleLoop3D", display: "Brooklyn Spots BridgeMovement SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_BridgeMovement_SimpleLoop3D, key: "sxa272", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_BridgeOverpass_SimpleLoop3D", display: "Brooklyn Spots BridgeOverpass SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_BridgeOverpass_SimpleLoop3D, key: "sxa273", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_FireAlarm_SimpleLoop3D", display: "Brooklyn Spots FireAlarm SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_FireAlarm_SimpleLoop3D, key: "sxa274", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_FoodTrailer_SimpleLoop3D", display: "Brooklyn Spots FoodTrailer SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_FoodTrailer_SimpleLoop3D, key: "sxa275", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_Fridge_SimpleLoop3D", display: "Brooklyn Spots Fridge SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_Fridge_SimpleLoop3D, key: "sxa276", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_GarbageCluster_SimpleLoop3D", display: "Brooklyn Spots GarbageCluster SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_GarbageCluster_SimpleLoop3D, key: "sxa277", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_MonitorStatic_SimpleLoop3D", display: "Brooklyn Spots MonitorStatic SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_MonitorStatic_SimpleLoop3D, key: "sxa278", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_PoliceChatter_OneShot_OneShot3D", display: "Brooklyn Spots PoliceChatter OneShot OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 2970, lengthText: "2.0s", lengthKey: "sxl20", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_PoliceChatter_OneShot_OneShot3D, key: "sxa279", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_PoliceChatter_SimpleLoop3D", display: "Brooklyn Spots PoliceChatter SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_PoliceChatter_SimpleLoop3D, key: "sxa280", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_RadioChatter_OneShot3D", display: "Brooklyn Spots RadioChatter OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 7770, lengthText: "6.8s", lengthKey: "sxl68", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_RadioChatter_OneShot3D, key: "sxa281", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_Riverside_Calm_SimpleLoop3D", display: "Brooklyn Spots Riverside Calm SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_Riverside_Calm_SimpleLoop3D, key: "sxa282", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_Riverside_SimpleLoop3D", display: "Brooklyn Spots Riverside SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_Riverside_SimpleLoop3D, key: "sxa283", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_SaxophoneInWall_OneShot3D", display: "Brooklyn Spots SaxophoneInWall OneShot3D", category: "Levels_Brooklyn", kind: "oneshot", dim: "3d", windowMs: 15000, lengthText: "10s+", lengthKey: "sxl10p", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_SaxophoneInWall_OneShot3D, key: "sxa284", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_SmallRadio_SimpleLoop3D", display: "Brooklyn Spots SmallRadio SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_SmallRadio_SimpleLoop3D, key: "sxa285", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_Vista_Riverside_SimpleLoop3D", display: "Brooklyn Spots Vista Riverside SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_Vista_Riverside_SimpleLoop3D, key: "sxa286", catKey: "sxg27" },
{ name: "SFX_Levels_Brooklyn_Spots_WelcomeSign_SimpleLoop3D", display: "Brooklyn Spots WelcomeSign SimpleLoop3D", category: "Levels_Brooklyn", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Brooklyn_Spots_WelcomeSign_SimpleLoop3D, key: "sxa287", catKey: "sxg27" },
{ name: "SFX_Levels_Cairo_MP_Abbasid_BigWorld_TheklaLarkSong_OneShot2D", display: "Cairo MP Abbasid BigWorld TheklaLarkSong OneShot2D", category: "Levels_Cairo", kind: "oneshot", dim: "2d", windowMs: 4140, lengthText: "3.1s", lengthKey: "sxl31", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Abbasid_BigWorld_TheklaLarkSong_OneShot2D, key: "sxa288", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Abbasid_Spots_Birds_Palace_SimpleLoop3D", display: "Cairo MP Abbasid Spots Birds Palace SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Abbasid_Spots_Birds_Palace_SimpleLoop3D, key: "sxa289", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Abbasid_Spots_BusWreck_OneShot3D", display: "Cairo MP Abbasid Spots BusWreck OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 9250, lengthText: "8.3s", lengthKey: "sxl83", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Abbasid_Spots_BusWreck_OneShot3D, key: "sxa290", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Abbasid_Spots_Firealarm_SimpleLoop3D", display: "Cairo MP Abbasid Spots Firealarm SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Abbasid_Spots_Firealarm_SimpleLoop3D, key: "sxa291", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Abbasid_Spots_Fountain_SimpleLoop3D", display: "Cairo MP Abbasid Spots Fountain SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Abbasid_Spots_Fountain_SimpleLoop3D, key: "sxa292", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Abbasid_Spots_HangingLamp_OneShot3D", display: "Cairo MP Abbasid Spots HangingLamp OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 3320, lengthText: "2.3s", lengthKey: "sxl23", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Abbasid_Spots_HangingLamp_OneShot3D, key: "sxa293", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Abbasid_Spots_HighwayTraffic_SimpleLoop3D", display: "Cairo MP Abbasid Spots HighwayTraffic SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Abbasid_Spots_HighwayTraffic_SimpleLoop3D, key: "sxa294", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Abbasid_Spots_HighwayWreckFire_SimpleLoop3D", display: "Cairo MP Abbasid Spots HighwayWreckFire SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Abbasid_Spots_HighwayWreckFire_SimpleLoop3D, key: "sxa295", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Abbasid_Spots_Intercom_SimpleLoop3D", display: "Cairo MP Abbasid Spots Intercom SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Abbasid_Spots_Intercom_SimpleLoop3D, key: "sxa296", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Abbasid_Spots_RatsInVent_SimpleLoop3D", display: "Cairo MP Abbasid Spots RatsInVent SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Abbasid_Spots_RatsInVent_SimpleLoop3D, key: "sxa297", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Abbasid_Spots_Waterpipe_SimpleLoop3D", display: "Cairo MP Abbasid Spots Waterpipe SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Abbasid_Spots_Waterpipe_SimpleLoop3D, key: "sxa298", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Outskirts_Spots_ExcavatorEngine_SimpleLoop3D", display: "Cairo MP Outskirts Spots ExcavatorEngine SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Outskirts_Spots_ExcavatorEngine_SimpleLoop3D, key: "sxa299", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Outskirts_Spots_PigeonTowerCreak_SimpleLoop3D", display: "Cairo MP Outskirts Spots PigeonTowerCreak SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Outskirts_Spots_PigeonTowerCreak_SimpleLoop3D, key: "sxa300", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Outskirts_Spots_RatsEating_SimpleLoop3D", display: "Cairo MP Outskirts Spots RatsEating SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Outskirts_Spots_RatsEating_SimpleLoop3D, key: "sxa301", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Outskirts_Spots_TrashPile_SimpleLoop3D", display: "Cairo MP Outskirts Spots TrashPile SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Outskirts_Spots_TrashPile_SimpleLoop3D, key: "sxa302", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_ClothFlaps_SimpleLoop3D", display: "Cairo MP Outskirts Spots Wind ClothFlaps SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_ClothFlaps_SimpleLoop3D, key: "sxa303", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_DesertWindGusts_SimpleLoop3D", display: "Cairo MP Outskirts Spots Wind DesertWindGusts SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_DesertWindGusts_SimpleLoop3D, key: "sxa304", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_HeavyGusts_SimpleLoop3D", display: "Cairo MP Outskirts Spots Wind HeavyGusts SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_HeavyGusts_SimpleLoop3D, key: "sxa305", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_HowlingHollow_High_SimpleLoop3D", display: "Cairo MP Outskirts Spots Wind HowlingHollow High SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_HowlingHollow_High_SimpleLoop3D, key: "sxa306", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_HowlingWarm_SimpleLoop3D", display: "Cairo MP Outskirts Spots Wind HowlingWarm SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_HowlingWarm_SimpleLoop3D, key: "sxa307", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_MetalWindGusts_SimpleLoop3D", display: "Cairo MP Outskirts Spots Wind MetalWindGusts SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_MetalWindGusts_SimpleLoop3D, key: "sxa308", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_RoadWind_SimpleLoop3D", display: "Cairo MP Outskirts Spots Wind RoadWind SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_RoadWind_SimpleLoop3D, key: "sxa309", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_Whistling_SimpleLoop3D", display: "Cairo MP Outskirts Spots Wind Whistling SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Outskirts_Spots_Wind_Whistling_SimpleLoop3D, key: "sxa310", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Shared_Bigworld_AmbWar_Weapons_OneShot3D", display: "Cairo MP Shared Bigworld AmbWar Weapons OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 3220, lengthText: "2.2s", lengthKey: "sxl22", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Shared_Bigworld_AmbWar_Weapons_OneShot3D, key: "sxa311", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Shared_Bigworld_Animals_EgyptianGoose_OneShot3D", display: "Cairo MP Shared Bigworld Animals EgyptianGoose OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 2620, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Shared_Bigworld_Animals_EgyptianGoose_OneShot3D, key: "sxa312", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Shared_Bigworld_Traffic_Carhorn_OneShot3D", display: "Cairo MP Shared Bigworld Traffic Carhorn OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Shared_Bigworld_Traffic_Carhorn_OneShot3D, key: "sxa313", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Shared_Bigworld_Winds_CItySandMist_SimpleLoop3D", display: "Cairo MP Shared Bigworld Winds CItySandMist SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Shared_Bigworld_Winds_CItySandMist_SimpleLoop3D, key: "sxa314", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_MP_Shared_Bigworld_Winds_SandMist_SimpleLoop3D", display: "Cairo MP Shared Bigworld Winds SandMist SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_MP_Shared_Bigworld_Winds_SandMist_SimpleLoop3D, key: "sxa315", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_Shared_BigWorld_SirenBy_OneShot3D", display: "Cairo Shared BigWorld SirenBy OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 8940, lengthText: "7.9s", lengthKey: "sxl79", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_Shared_BigWorld_SirenBy_OneShot3D, key: "sxa316", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_Shared_Spots_Banner_SimpleLoop3D", display: "Cairo Shared Spots Banner SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_Shared_Spots_Banner_SimpleLoop3D, key: "sxa317", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_Shared_Spots_BirdsAlley_OneShot3D", display: "Cairo Shared Spots BirdsAlley OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 4250, lengthText: "3.3s", lengthKey: "sxl33", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_Shared_Spots_BirdsAlley_OneShot3D, key: "sxa318", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_Shared_Spots_CommonMynah_OneShot3D", display: "Cairo Shared Spots CommonMynah OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 4250, lengthText: "3.3s", lengthKey: "sxl33", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_Shared_Spots_CommonMynah_OneShot3D, key: "sxa319", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_Shared_Spots_DistantChants_OneShot3D", display: "Cairo Shared Spots DistantChants OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 4370, lengthText: "3.4s", lengthKey: "sxl34", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_Shared_Spots_DistantChants_OneShot3D, key: "sxa320", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_Shared_Spots_Highway_SimpleLoop3D", display: "Cairo Shared Spots Highway SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_Shared_Spots_Highway_SimpleLoop3D, key: "sxa321", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_Shared_Spots_Insects_OneShot3D", display: "Cairo Shared Spots Insects OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 4340, lengthText: "3.3s", lengthKey: "sxl33", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_Shared_Spots_Insects_OneShot3D, key: "sxa322", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_Shared_Spots_Locusts_OneShot3D", display: "Cairo Shared Spots Locusts OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 4520, lengthText: "3.5s", lengthKey: "sxl35", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_Shared_Spots_Locusts_OneShot3D, key: "sxa323", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_Shared_Spots_OliveTree_Crickets_SimpleLoop3D", display: "Cairo Shared Spots OliveTree Crickets SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_Shared_Spots_OliveTree_Crickets_SimpleLoop3D, key: "sxa324", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_Shared_Spots_VehicleStress_SimpleLoop3D", display: "Cairo Shared Spots VehicleStress SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_Shared_Spots_VehicleStress_SimpleLoop3D, key: "sxa325", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_BigWorld_AluminiumCanDrop_OneShot3D", display: "Cairo SP NightRaid BigWorld AluminiumCanDrop OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 2920, lengthText: "1.9s", lengthKey: "sxl19", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_BigWorld_AluminiumCanDrop_OneShot3D, key: "sxa326", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_BigWorld_BullhornSiren_OneShot3D", display: "Cairo SP NightRaid BigWorld BullhornSiren OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 3930, lengthText: "2.9s", lengthKey: "sxl29", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_BigWorld_BullhornSiren_OneShot3D, key: "sxa327", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_BigWorld_Glass_BottleDrop_OneShot3D", display: "Cairo SP NightRaid BigWorld Glass BottleDrop OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_BigWorld_Glass_BottleDrop_OneShot3D, key: "sxa328", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_BigWorld_Glass_WindowSmash_OneShot3D", display: "Cairo SP NightRaid BigWorld Glass WindowSmash OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 2530, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_BigWorld_Glass_WindowSmash_OneShot3D, key: "sxa329", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_BigWorld_Object_ClotheslineRustle_OneShot3D", display: "Cairo SP NightRaid BigWorld Object ClotheslineRustle OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_BigWorld_Object_ClotheslineRustle_OneShot3D, key: "sxa330", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_BigWorld_Object_RugFlap_OneShot3D", display: "Cairo SP NightRaid BigWorld Object RugFlap OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_BigWorld_Object_RugFlap_OneShot3D, key: "sxa331", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_FireDrippingLow_OneShot3D", display: "Cairo SP NightRaid Spots Fire FireDrippingLow OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_FireDrippingLow_OneShot3D, key: "sxa332", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_Flare_SimpleLoop3D", display: "Cairo SP NightRaid Spots Fire Flare SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_Flare_SimpleLoop3D, key: "sxa333", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_FlareShot_OneShot3D", display: "Cairo SP NightRaid Spots Fire FlareShot OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 3160, lengthText: "2.2s", lengthKey: "sxl22", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_FlareShot_OneShot3D, key: "sxa334", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_FlareShotExplode_OneShot3D", display: "Cairo SP NightRaid Spots Fire FlareShotExplode OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_FlareShotExplode_OneShot3D, key: "sxa335", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_IvyXS_SimpleLoop3D", display: "Cairo SP NightRaid Spots Fire IvyXS SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_IvyXS_SimpleLoop3D, key: "sxa336", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_PalaceFabric_SimpleLoop3D", display: "Cairo SP NightRaid Spots Fire PalaceFabric SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_PalaceFabric_SimpleLoop3D, key: "sxa337", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_PalaceFurniture_SimpleLoop3D", display: "Cairo SP NightRaid Spots Fire PalaceFurniture SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_PalaceFurniture_SimpleLoop3D, key: "sxa338", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_PalaceSmall_SimpleLoop3D", display: "Cairo SP NightRaid Spots Fire PalaceSmall SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_PalaceSmall_SimpleLoop3D, key: "sxa339", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_PalaceSmoke_SimpleLoop3D", display: "Cairo SP NightRaid Spots Fire PalaceSmoke SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_PalaceSmoke_SimpleLoop3D, key: "sxa340", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_PalaceTiny_SimpleLoop3D", display: "Cairo SP NightRaid Spots Fire PalaceTiny SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_PalaceTiny_SimpleLoop3D, key: "sxa341", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_PalaceVegetation_SimpleLoop3D", display: "Cairo SP NightRaid Spots Fire PalaceVegetation SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_PalaceVegetation_SimpleLoop3D, key: "sxa342", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_ProjectileMolotovLand_OneShot3D", display: "Cairo SP NightRaid Spots Fire ProjectileMolotovLand OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 3170, lengthText: "2.2s", lengthKey: "sxl22", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_ProjectileMolotovLand_OneShot3D, key: "sxa343", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_ProjectileMolotovThrow_OneShot3D", display: "Cairo SP NightRaid Spots Fire ProjectileMolotovThrow OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 3840, lengthText: "2.8s", lengthKey: "sxl28", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_ProjectileMolotovThrow_OneShot3D, key: "sxa344", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_RiotMolotovLand_OneShot3D", display: "Cairo SP NightRaid Spots Fire RiotMolotovLand OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 3830, lengthText: "2.8s", lengthKey: "sxl28", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_RiotMolotovLand_OneShot3D, key: "sxa345", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_SparksGround_SimpleLoop3D", display: "Cairo SP NightRaid Spots Fire SparksGround SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Fire_SparksGround_SimpleLoop3D, key: "sxa346", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_HelicopterWind_SimpleLoop3D", display: "Cairo SP NightRaid Spots HelicopterWind SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_HelicopterWind_SimpleLoop3D, key: "sxa347", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_HighwayUnderneath_SimpleLoop3D", display: "Cairo SP NightRaid Spots HighwayUnderneath SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_HighwayUnderneath_SimpleLoop3D, key: "sxa348", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_LightbulbMoths_SimpleLoop3D", display: "Cairo SP NightRaid Spots LightbulbMoths SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_LightbulbMoths_SimpleLoop3D, key: "sxa349", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Molotov_OneShot3D", display: "Cairo SP NightRaid Spots Molotov OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 3970, lengthText: "3.0s", lengthKey: "sxl30", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Molotov_OneShot3D, key: "sxa350", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_MotorScooterIdle_SimpleLoop3D", display: "Cairo SP NightRaid Spots MotorScooterIdle SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_MotorScooterIdle_SimpleLoop3D, key: "sxa351", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_PalaceFireAlarm_SimpleLoop3D", display: "Cairo SP NightRaid Spots PalaceFireAlarm SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_PalaceFireAlarm_SimpleLoop3D, key: "sxa352", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Riot_Activity_SimpleLoop3D", display: "Cairo SP NightRaid Spots Riot Activity SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Riot_Activity_SimpleLoop3D, key: "sxa353", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Riot_CrowdRumble_SimpleLoop3D", display: "Cairo SP NightRaid Spots Riot CrowdRumble SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Riot_CrowdRumble_SimpleLoop3D, key: "sxa354", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Riot_FenceShake_SimpleLoop3D", display: "Cairo SP NightRaid Spots Riot FenceShake SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Riot_FenceShake_SimpleLoop3D, key: "sxa355", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Riot_MetalDestruction_SimpleLoop3D", display: "Cairo SP NightRaid Spots Riot MetalDestruction SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Riot_MetalDestruction_SimpleLoop3D, key: "sxa356", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Riot_TearGas_SimpleLoop3D", display: "Cairo SP NightRaid Spots Riot TearGas SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Riot_TearGas_SimpleLoop3D, key: "sxa357", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_RockHit_OneShot3D", display: "Cairo SP NightRaid Spots RockHit OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_RockHit_OneShot3D, key: "sxa358", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_RopeStress_OneShot3D", display: "Cairo SP NightRaid Spots RopeStress OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 3260, lengthText: "2.3s", lengthKey: "sxl23", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_RopeStress_OneShot3D, key: "sxa359", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_ScaffoldingTarp_SimpleLoop3D", display: "Cairo SP NightRaid Spots ScaffoldingTarp SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_ScaffoldingTarp_SimpleLoop3D, key: "sxa360", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Sewers_WaterDrippingLarge_SimpleLoop3D", display: "Cairo SP NightRaid Spots Sewers WaterDrippingLarge SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Sewers_WaterDrippingLarge_SimpleLoop3D, key: "sxa361", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Sewers_WaterDrippingMedium_SimpleLoop3D", display: "Cairo SP NightRaid Spots Sewers WaterDrippingMedium SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Sewers_WaterDrippingMedium_SimpleLoop3D, key: "sxa362", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Sewers_WaterDrippingSmall_SimpleLoop3D", display: "Cairo SP NightRaid Spots Sewers WaterDrippingSmall SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Sewers_WaterDrippingSmall_SimpleLoop3D, key: "sxa363", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Sewers_WaterDrips_SimpleLoop3D", display: "Cairo SP NightRaid Spots Sewers WaterDrips SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Sewers_WaterDrips_SimpleLoop3D, key: "sxa364", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Sewers_WaterSquirt_SimpleLoop3D", display: "Cairo SP NightRaid Spots Sewers WaterSquirt SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Sewers_WaterSquirt_SimpleLoop3D, key: "sxa365", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_SwingSet_SimpleLoop3D", display: "Cairo SP NightRaid Spots SwingSet SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_SwingSet_SimpleLoop3D, key: "sxa366", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Walla_Riot_SimpleLoop3D", display: "Cairo SP NightRaid Spots Walla Riot SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Walla_Riot_SimpleLoop3D, key: "sxa367", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Walla_RiotBullhorn_OneShot3D", display: "Cairo SP NightRaid Spots Walla RiotBullhorn OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Walla_RiotBullhorn_OneShot3D, key: "sxa368", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Walla_RiotCrowd_SimpleLoop3D", display: "Cairo SP NightRaid Spots Walla RiotCrowd SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Walla_RiotCrowd_SimpleLoop3D, key: "sxa369", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Walla_RiotCrowdCheer_SimpleLoop3D", display: "Cairo SP NightRaid Spots Walla RiotCrowdCheer SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Walla_RiotCrowdCheer_SimpleLoop3D, key: "sxa370", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_WashingMachine_SimpleLoop3D", display: "Cairo SP NightRaid Spots WashingMachine SimpleLoop3D", category: "Levels_Cairo", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_WashingMachine_SimpleLoop3D, key: "sxa371", catKey: "sxg28" },
{ name: "SFX_Levels_Cairo_SP_NightRaid_Spots_Whistle_OneShot3D", display: "Cairo SP NightRaid Spots Whistle OneShot3D", category: "Levels_Cairo", kind: "oneshot", dim: "3d", windowMs: 3680, lengthText: "2.7s", lengthKey: "sxl27", asset: mod.RuntimeSpawn_Common.SFX_Levels_Cairo_SP_NightRaid_Spots_Whistle_OneShot3D, key: "sxa372", catKey: "sxg28" },
{ name: "SFX_Projectiles_Flybys_Bullet_Crack_DMR_Distant_OneShot3D", display: "Flybys Bullet Crack DMR Distant OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2720, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Crack_DMR_Distant_OneShot3D, key: "sxa373", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Bullet_Crack_Intermediate_Close_Indoor_OneShot3D", display: "Flybys Bullet Crack Intermediate Close Indoor OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Crack_Intermediate_Close_Indoor_OneShot3D, key: "sxa374", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Bullet_Crack_Intermediate_Close_OneShot3D", display: "Flybys Bullet Crack Intermediate Close OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Crack_Intermediate_Close_OneShot3D, key: "sxa375", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Bullet_Crack_Intermediate_Distant_OneShot3D", display: "Flybys Bullet Crack Intermediate Distant OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Crack_Intermediate_Distant_OneShot3D, key: "sxa376", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Bullet_Crack_Rifle_Close_OneShot3D", display: "Flybys Bullet Crack Rifle Close OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2790, lengthText: "1.8s", lengthKey: "sxl18", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Crack_Rifle_Close_OneShot3D, key: "sxa377", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Bullet_Crack_Rifle_Distant_OneShot3D", display: "Flybys Bullet Crack Rifle Distant OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Crack_Rifle_Distant_OneShot3D, key: "sxa378", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Bullet_Crack_Sniper_Close_OneShot3D", display: "Flybys Bullet Crack Sniper Close OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Crack_Sniper_Close_OneShot3D, key: "sxa379", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Bullet_Crack_Sniper_Distant_OneShot3D", display: "Flybys Bullet Crack Sniper Distant OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 3570, lengthText: "2.6s", lengthKey: "sxl26", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Crack_Sniper_Distant_OneShot3D, key: "sxa380", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Bullet_Whizby_Intermediate_Main_Distant_OneShot3D", display: "Flybys Bullet Whizby Intermediate Main Distant OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Whizby_Intermediate_Main_Distant_OneShot3D, key: "sxa381", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Bullet_Whizby_Intermediate_Main_OneShot3D", display: "Flybys Bullet Whizby Intermediate Main OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Whizby_Intermediate_Main_OneShot3D, key: "sxa382", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Bullet_Whizby_Intermediate_Main_Underwater_OneShot3D", display: "Flybys Bullet Whizby Intermediate Main Underwater OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2740, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Whizby_Intermediate_Main_Underwater_OneShot3D, key: "sxa383", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Bullet_Whizby_Intermediate_Sweetener_Buckshot_OneShot3D", display: "Flybys Bullet Whizby Intermediate Sweetener Buckshot OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Whizby_Intermediate_Sweetener_Buckshot_OneShot3D, key: "sxa384", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Bullet_Whizby_Intermediate_Sweetener_OneShot3D", display: "Flybys Bullet Whizby Intermediate Sweetener OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Whizby_Intermediate_Sweetener_OneShot3D, key: "sxa385", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Bullet_Whizby_Sniper_Main_OneShot3D", display: "Flybys Bullet Whizby Sniper Main OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Bullet_Whizby_Sniper_Main_OneShot3D, key: "sxa386", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Large_AutoCannon_40mm_FlyBy_OneShot3D", display: "Flybys Large AutoCannon 40mm FlyBy OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Large_AutoCannon_40mm_FlyBy_OneShot3D, key: "sxa387", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Large_Cannon_Shell_120mm_Distant_SimpleLoop3D", display: "Flybys Large Cannon Shell 120mm Distant SimpleLoop3D", category: "Projectiles_Flybys", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Large_Cannon_Shell_120mm_Distant_SimpleLoop3D, key: "sxa388", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Large_Cannon_Shell_120mm_FlyBy_Close_OneShot3D", display: "Flybys Large Cannon Shell 120mm FlyBy Close OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Large_Cannon_Shell_120mm_FlyBy_Close_OneShot3D, key: "sxa389", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Large_Cannon_Shell_120mm_FlyBy_Distant_OneShot3D", display: "Flybys Large Cannon Shell 120mm FlyBy Distant OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2850, lengthText: "1.9s", lengthKey: "sxl19", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Large_Cannon_Shell_120mm_FlyBy_Distant_OneShot3D, key: "sxa390", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Large_Rocket_Missile_FlyBy_OneShot3D", display: "Flybys Large Rocket Missile FlyBy OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2600, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Large_Rocket_Missile_FlyBy_OneShot3D, key: "sxa391", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Large_Rocket_Missile_Ignite_OneShot3D", display: "Flybys Large Rocket Missile Ignite OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 3190, lengthText: "2.2s", lengthKey: "sxl22", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Large_Rocket_Missile_Ignite_OneShot3D, key: "sxa392", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Large_Rocket_Missile_Trail_SimpleLoop3D", display: "Flybys Large Rocket Missile Trail SimpleLoop3D", category: "Projectiles_Flybys", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Large_Rocket_Missile_Trail_SimpleLoop3D, key: "sxa393", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Large_Rocket_RocketPod_Trail_Distant_SimpleLoop3D", display: "Flybys Large Rocket RocketPod Trail Distant SimpleLoop3D", category: "Projectiles_Flybys", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Large_Rocket_RocketPod_Trail_Distant_SimpleLoop3D, key: "sxa394", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Large_Rocket_RPG_FlyBy_Distant_OneShot3D", display: "Flybys Large Rocket RPG FlyBy Distant OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2770, lengthText: "1.8s", lengthKey: "sxl18", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Large_Rocket_RPG_FlyBy_Distant_OneShot3D, key: "sxa395", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Shared_Projectile_Flyby_OneShot3D", display: "Flybys Shared Projectile Flyby OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Shared_Projectile_Flyby_OneShot3D, key: "sxa396", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Shared_Projectile_MissileTrail_SimpleLoop3D", display: "Flybys Shared Projectile MissileTrail SimpleLoop3D", category: "Projectiles_Flybys", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Shared_Projectile_MissileTrail_SimpleLoop3D, key: "sxa397", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Shared_RocketStart_OneShot3D", display: "Flybys Shared RocketStart OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 3860, lengthText: "2.9s", lengthKey: "sxl29", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Shared_RocketStart_OneShot3D, key: "sxa398", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Shared_SmallAntiTank_SimpleLoop3D", display: "Flybys Shared SmallAntiTank SimpleLoop3D", category: "Projectiles_Flybys", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Shared_SmallAntiTank_SimpleLoop3D, key: "sxa399", catKey: "sxg29" },
{ name: "SFX_Projectiles_Flybys_Shared_SmallAntiTank_Starter_OneShot3D", display: "Flybys Shared SmallAntiTank Starter OneShot3D", category: "Projectiles_Flybys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_Flybys_Shared_SmallAntiTank_Starter_OneShot3D, key: "sxa400", catKey: "sxg29" },
{ name: "SFX_Projectiles_FlyBys_Large_GrenadeLauncher_40mm_Close_SimpleLoop3D", display: "FlyBys Large GrenadeLauncher 40mm Close SimpleLoop3D", category: "Projectiles_FlyBys", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_FlyBys_Large_GrenadeLauncher_40mm_Close_SimpleLoop3D, key: "sxa401", catKey: "sxg30" },
{ name: "SFX_Projectiles_FlyBys_Large_GrenadeLauncher_40mm_OneShot3D", display: "FlyBys Large GrenadeLauncher 40mm OneShot3D", category: "Projectiles_FlyBys", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_FlyBys_Large_GrenadeLauncher_40mm_OneShot3D, key: "sxa402", catKey: "sxg30" },
{ name: "SFX_Projectiles_FlyBys_Shells_Artillery_Incoming_OneShot3D", display: "FlyBys Shells Artillery Incoming OneShot3D", category: "Projectiles_FlyBys", kind: "oneshot", dim: "3d", windowMs: 2570, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_Projectiles_FlyBys_Shells_Artillery_Incoming_OneShot3D, key: "sxa403", catKey: "sxg30" },
{ name: "SFX_Soldier_Damage_ArmorBreakSelf_OneShot2D", display: "Damage ArmorBreakSelf OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_ArmorBreakSelf_OneShot2D, key: "sxa404", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_ArmorDamage_Enemy_OneShot2D", display: "Damage ArmorDamage Enemy OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_ArmorDamage_Enemy_OneShot2D, key: "sxa405", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_ArmorDamage_Hard_Self_OneShot2D", display: "Damage ArmorDamage Hard Self OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_ArmorDamage_Hard_Self_OneShot2D, key: "sxa406", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_ArmorDamage_Soft_Self_OneShot2D", display: "Damage ArmorDamage Soft Self OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_ArmorDamage_Soft_Self_OneShot2D, key: "sxa407", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_BarbedWire_Death_OneShot2D", display: "Damage BarbedWire Death OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2800, lengthText: "1.8s", lengthKey: "sxl18", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_BarbedWire_Death_OneShot2D, key: "sxa408", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_BarbedWire_OneShot2D", display: "Damage BarbedWire OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2690, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_BarbedWire_OneShot2D, key: "sxa409", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Bullet_Death_NoRevive_OneShot2D", display: "Damage Bullet Death NoRevive OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Bullet_Death_NoRevive_OneShot2D, key: "sxa410", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Bullet_Headshot_OneShot2D", display: "Damage Bullet Headshot OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Bullet_Headshot_OneShot2D, key: "sxa411", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Bullet_HeadshotAdd_OneShot2D", display: "Damage Bullet HeadshotAdd OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Bullet_HeadshotAdd_OneShot2D, key: "sxa412", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Bullet_OneShot2D", display: "Damage Bullet OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Bullet_OneShot2D, key: "sxa413", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_BulletThump_OneShot2D", display: "Damage BulletThump OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_BulletThump_OneShot2D, key: "sxa414", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Defibs_Death_OneShot2D", display: "Damage Defibs Death OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Defibs_Death_OneShot2D, key: "sxa415", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Defibs_OneShot2D", display: "Damage Defibs OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Defibs_OneShot2D, key: "sxa416", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Destruction_Death_OneShot2D", display: "Damage Destruction Death OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 4470, lengthText: "3.5s", lengthKey: "sxl35", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Destruction_Death_OneShot2D, key: "sxa417", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Destruction_OneShot2D", display: "Damage Destruction OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 3740, lengthText: "2.7s", lengthKey: "sxl27", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Destruction_OneShot2D, key: "sxa418", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Drowning_OneShot2D", display: "Damage Drowning OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 4770, lengthText: "3.8s", lengthKey: "sxl38", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Drowning_OneShot2D, key: "sxa419", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Explosion_Crack_OneShot2D", display: "Damage Explosion Crack OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 3040, lengthText: "2.0s", lengthKey: "sxl20", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Explosion_Crack_OneShot2D, key: "sxa420", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Explosion_Death_OneShot2D", display: "Damage Explosion Death OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 3940, lengthText: "2.9s", lengthKey: "sxl29", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Explosion_Death_OneShot2D, key: "sxa421", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Explosion_Ring_SimpleLoop2D", display: "Damage Explosion Ring SimpleLoop2D", category: "Soldier_Damage", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Explosion_Ring_SimpleLoop2D, key: "sxa422", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_ExplosionDebris_OneShot2D", display: "Damage ExplosionDebris OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 3490, lengthText: "2.5s", lengthKey: "sxl25", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_ExplosionDebris_OneShot2D, key: "sxa423", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Fall_Death_OneShot2D", display: "Damage Fall Death OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2740, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Fall_Death_OneShot2D, key: "sxa424", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Fall_Low_OneShot2D", display: "Damage Fall Low OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Fall_Low_OneShot2D, key: "sxa425", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Fall_Medium_OneShot2D", display: "Damage Fall Medium OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Fall_Medium_OneShot2D, key: "sxa426", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Fire_Death_OneShot2D", display: "Damage Fire Death OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 5380, lengthText: "4.4s", lengthKey: "sxl44", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Fire_Death_OneShot2D, key: "sxa427", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Fire_Normal_SimpleLoop2D", display: "Damage Fire Normal SimpleLoop2D", category: "Soldier_Damage", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Fire_Normal_SimpleLoop2D, key: "sxa428", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Fire_Small_SimpleLoop2D", display: "Damage Fire Small SimpleLoop2D", category: "Soldier_Damage", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Fire_Small_SimpleLoop2D, key: "sxa429", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Fire_Start_OneShot2D", display: "Damage Fire Start OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Fire_Start_OneShot2D, key: "sxa430", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Melee_Death_OneShot2D", display: "Damage Melee Death OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Melee_Death_OneShot2D, key: "sxa431", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_MeleeBlunt_OneShot2D", display: "Damage MeleeBlunt OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_MeleeBlunt_OneShot2D, key: "sxa432", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_MeleeKnife_Death_OneShot2D", display: "Damage MeleeKnife Death OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_MeleeKnife_Death_OneShot2D, key: "sxa433", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_MeleeKnife_OneShot2D", display: "Damage MeleeKnife OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_MeleeKnife_OneShot2D, key: "sxa434", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Ring_Death_OneShot2D", display: "Damage Ring Death OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 5330, lengthText: "4.3s", lengthKey: "sxl43", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Ring_Death_OneShot2D, key: "sxa435", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Ring_Normal_OneShot2D", display: "Damage Ring Normal OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 15000, lengthText: "10s+", lengthKey: "sxl10p", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Ring_Normal_OneShot2D, key: "sxa436", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Ring_Start_OneShot2D", display: "Damage Ring Start OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 3390, lengthText: "2.4s", lengthKey: "sxl24", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Ring_Start_OneShot2D, key: "sxa437", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Sabotage_Death_OneShot2D", display: "Damage Sabotage Death OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 3700, lengthText: "2.7s", lengthKey: "sxl27", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Sabotage_Death_OneShot2D, key: "sxa438", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Sabotage_OneShot2D", display: "Damage Sabotage OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2610, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Sabotage_OneShot2D, key: "sxa439", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_Throwable_OneShot2D", display: "Damage Throwable OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_Throwable_OneShot2D, key: "sxa440", catKey: "sxg31" },
{ name: "SFX_Soldier_Damage_ThrowingKnife_OneShot2D", display: "Damage ThrowingKnife OneShot2D", category: "Soldier_Damage", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Damage_ThrowingKnife_OneShot2D, key: "sxa441", catKey: "sxg31" },
{ name: "SFX_Soldier_Events_Damage_BreathFemale_SimpleLoop2D", display: "Events Damage BreathFemale SimpleLoop2D", category: "Soldier_Events", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_Damage_BreathFemale_SimpleLoop2D, key: "sxa442", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_Damage_BreathMale_SimpleLoop2D", display: "Events Damage BreathMale SimpleLoop2D", category: "Soldier_Events", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_Damage_BreathMale_SimpleLoop2D, key: "sxa443", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_BreathFemale_OneShot2D", display: "Events SoldierDown BreathFemale OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 2900, lengthText: "1.9s", lengthKey: "sxl19", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_BreathFemale_OneShot2D, key: "sxa444", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_BreathFemale_SimpleLoop2D", display: "Events SoldierDown BreathFemale SimpleLoop2D", category: "Soldier_Events", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_BreathFemale_SimpleLoop2D, key: "sxa445", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_BreathMale_OneShot2D", display: "Events SoldierDown BreathMale OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 2890, lengthText: "1.9s", lengthKey: "sxl19", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_BreathMale_OneShot2D, key: "sxa446", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_BreathMale_SimpleLoop2D", display: "Events SoldierDown BreathMale SimpleLoop2D", category: "Soldier_Events", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_BreathMale_SimpleLoop2D, key: "sxa447", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_DeathSigh_OneShot2D", display: "Events SoldierDown DeathSigh OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_DeathSigh_OneShot2D, key: "sxa448", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_DeathStinger_OneShot2D", display: "Events SoldierDown DeathStinger OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 3870, lengthText: "2.9s", lengthKey: "sxl29", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_DeathStinger_OneShot2D, key: "sxa449", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_DeathStingerSkipRevive_OneShot2D", display: "Events SoldierDown DeathStingerSkipRevive OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 3810, lengthText: "2.8s", lengthKey: "sxl28", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_DeathStingerSkipRevive_OneShot2D, key: "sxa450", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_Drone_BleedOut_SimpleLoop2D", display: "Events SoldierDown Drone BleedOut SimpleLoop2D", category: "Soldier_Events", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_Drone_BleedOut_SimpleLoop2D, key: "sxa451", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_Drone_HighIntensity_SimpleLoop2D", display: "Events SoldierDown Drone HighIntensity SimpleLoop2D", category: "Soldier_Events", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_Drone_HighIntensity_SimpleLoop2D, key: "sxa452", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_Enter_OneShot2D", display: "Events SoldierDown Enter OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 3820, lengthText: "2.8s", lengthKey: "sxl28", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_Enter_OneShot2D, key: "sxa453", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_EnterNoDeployScreen_OneShot2D", display: "Events SoldierDown EnterNoDeployScreen OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 6160, lengthText: "5.2s", lengthKey: "sxl52", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_EnterNoDeployScreen_OneShot2D, key: "sxa454", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_Foley_FoleyOnGroundStart_OneShot2D", display: "Events SoldierDown Foley FoleyOnGroundStart OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 3130, lengthText: "2.1s", lengthKey: "sxl21", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_Foley_FoleyOnGroundStart_OneShot2D, key: "sxa455", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_Foley_MovementLoop_SimpleLoop2D", display: "Events SoldierDown Foley MovementLoop SimpleLoop2D", category: "Soldier_Events", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_Foley_MovementLoop_SimpleLoop2D, key: "sxa456", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_Foley_OnGround_OneShot2D", display: "Events SoldierDown Foley OnGround OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 2950, lengthText: "2.0s", lengthKey: "sxl20", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_Foley_OnGround_OneShot2D, key: "sxa457", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_Foley_SkipReviveStart_OneShot2D", display: "Events SoldierDown Foley SkipReviveStart OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_Foley_SkipReviveStart_OneShot2D, key: "sxa458", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_Foley_SkipReviveStop_OneShot2D", display: "Events SoldierDown Foley SkipReviveStop OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_Foley_SkipReviveStop_OneShot2D, key: "sxa459", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_GeneralDrone_SimpleLoop2D", display: "Events SoldierDown GeneralDrone SimpleLoop2D", category: "Soldier_Events", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_GeneralDrone_SimpleLoop2D, key: "sxa460", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_HeartBeat_EKG_OneShot2D", display: "Events SoldierDown HeartBeat EKG OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 2960, lengthText: "2.0s", lengthKey: "sxl20", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_HeartBeat_EKG_OneShot2D, key: "sxa461", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_HeartBeat_OneShot2D", display: "Events SoldierDown HeartBeat OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_HeartBeat_OneShot2D, key: "sxa462", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_LandOnGround_EffortFemale_OneShot2D", display: "Events SoldierDown LandOnGround EffortFemale OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_LandOnGround_EffortFemale_OneShot2D, key: "sxa463", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_LandOnGround_EffortMale_OneShot2D", display: "Events SoldierDown LandOnGround EffortMale OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_LandOnGround_EffortMale_OneShot2D, key: "sxa464", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_LowHealth_Drone_SimpleLoop2D", display: "Events SoldierDown LowHealth Drone SimpleLoop2D", category: "Soldier_Events", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_LowHealth_Drone_SimpleLoop2D, key: "sxa465", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_LowHealth_Enter_OneShot2D", display: "Events SoldierDown LowHealth Enter OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 2690, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_LowHealth_Enter_OneShot2D, key: "sxa466", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_ReviveSickness_Drone_SimpleLoop2D", display: "Events SoldierDown ReviveSickness Drone SimpleLoop2D", category: "Soldier_Events", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_ReviveSickness_Drone_SimpleLoop2D, key: "sxa467", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_Skip_SimpleLoop2D", display: "Events SoldierDown Skip SimpleLoop2D", category: "Soldier_Events", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_Skip_SimpleLoop2D, key: "sxa468", catKey: "sxg32" },
{ name: "SFX_Soldier_Events_SoldierDown_Skip_Start_OneShot2D", display: "Events SoldierDown Skip Start OneShot2D", category: "Soldier_Events", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Events_SoldierDown_Skip_Start_OneShot2D, key: "sxa469", catKey: "sxg32" },
{ name: "SFX_Soldier_FieldUpgrade_Engineer_Repairtool_Start_OneShot3D", display: "FieldUpgrade Engineer Repairtool Start OneShot3D", category: "Soldier_FieldUpgrade", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_Soldier_FieldUpgrade_Engineer_Repairtool_Start_OneShot3D, key: "sxa470", catKey: "sxg33" },
{ name: "SFX_Soldier_FieldUpgrade_Engineer_Repairtool_Stop_OneShot3D", display: "FieldUpgrade Engineer Repairtool Stop OneShot3D", category: "Soldier_FieldUpgrade", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Soldier_FieldUpgrade_Engineer_Repairtool_Stop_OneShot3D, key: "sxa471", catKey: "sxg33" },
{ name: "SFX_Soldier_FieldUpgrade_Support_ActiveMedic_Start_OneShot3D", display: "FieldUpgrade Support ActiveMedic Start OneShot3D", category: "Soldier_FieldUpgrade", kind: "oneshot", dim: "3d", windowMs: 2720, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_Soldier_FieldUpgrade_Support_ActiveMedic_Start_OneShot3D, key: "sxa472", catKey: "sxg33" },
{ name: "SFX_Soldier_FieldUpgrade_Support_ActiveMedic_Stop_OneShot3D", display: "FieldUpgrade Support ActiveMedic Stop OneShot3D", category: "Soldier_FieldUpgrade", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_FieldUpgrade_Support_ActiveMedic_Stop_OneShot3D, key: "sxa473", catKey: "sxg33" },
{ name: "SFX_Soldier_Health_FullHealth_OneShot2D", display: "Health FullHealth OneShot2D", category: "Soldier_Health", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Health_FullHealth_OneShot2D, key: "sxa474", catKey: "sxg34" },
{ name: "SFX_Soldier_Health_Start_Regenerate_OneShot2D", display: "Health Start Regenerate OneShot2D", category: "Soldier_Health", kind: "oneshot", dim: "2d", windowMs: 4990, lengthText: "4.0s", lengthKey: "sxl40", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Health_Start_Regenerate_OneShot2D, key: "sxa475", catKey: "sxg34" },
{ name: "SFX_Soldier_Interact_KeycardPickup_OneShot3D", display: "Interact KeycardPickup OneShot3D", category: "Soldier_Interact", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Interact_KeycardPickup_OneShot3D, key: "sxa476", catKey: "sxg35" },
{ name: "SFX_Soldier_Interact_Pickup_OneShot3D", display: "Interact Pickup OneShot3D", category: "Soldier_Interact", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Interact_Pickup_OneShot3D, key: "sxa477", catKey: "sxg35" },
{ name: "SFX_Soldier_Interact_UpgradeKitPickup_OneShot3D", display: "Interact UpgradeKitPickup OneShot3D", category: "Soldier_Interact", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Interact_UpgradeKitPickup_OneShot3D, key: "sxa478", catKey: "sxg35" },
{ name: "SFX_Soldier_Interact_WeaponPickup_OneShot3D", display: "Interact WeaponPickup OneShot3D", category: "Soldier_Interact", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Interact_WeaponPickup_OneShot3D, key: "sxa479", catKey: "sxg35" },
{ name: "SFX_Soldier_Melee_AttackFoley_OneShot2D", display: "Melee AttackFoley OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_AttackFoley_OneShot2D, key: "sxa480", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_AttackFoley_OneShot3D", display: "Melee AttackFoley OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_AttackFoley_OneShot3D, key: "sxa481", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Hit_OneShot2D", display: "Melee Hit OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Hit_OneShot2D, key: "sxa482", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Hit_OneShot3D", display: "Melee Hit OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Hit_OneShot3D, key: "sxa483", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_ArmFoley_Stab_OneShot2D", display: "Melee Takedown Attacker ArmFoley Stab OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_ArmFoley_Stab_OneShot2D, key: "sxa484", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_ArmFoley_Stab_OneShot3D", display: "Melee Takedown Attacker ArmFoley Stab OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_ArmFoley_Stab_OneShot3D, key: "sxa485", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_CollectDogtag_OneShot2D", display: "Melee Takedown Attacker CollectDogtag OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_CollectDogtag_OneShot2D, key: "sxa486", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_CollectDogtag_OneShot3D", display: "Melee Takedown Attacker CollectDogtag OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_CollectDogtag_OneShot3D, key: "sxa487", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_EndKnife_OneShot2D", display: "Melee Takedown Attacker EndKnife OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2710, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_EndKnife_OneShot2D, key: "sxa488", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_EndKnife_OneShot3D", display: "Melee Takedown Attacker EndKnife OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2830, lengthText: "1.8s", lengthKey: "sxl18", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_EndKnife_OneShot3D, key: "sxa489", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_Equip_Knife_OneShot2D", display: "Melee Takedown Attacker Equip Knife OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_Equip_Knife_OneShot2D, key: "sxa490", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_Equip_Knife_OneShot3D", display: "Melee Takedown Attacker Equip Knife OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_Equip_Knife_OneShot3D, key: "sxa491", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_Equip_Sledgehammer_OneShot2D", display: "Melee Takedown Attacker Equip Sledgehammer OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_Equip_Sledgehammer_OneShot2D, key: "sxa492", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_Equip_Sledgehammer_OneShot3D", display: "Melee Takedown Attacker Equip Sledgehammer OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_Equip_Sledgehammer_OneShot3D, key: "sxa493", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_Female_OneShot2D", display: "Melee Takedown Attacker Female OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_Female_OneShot2D, key: "sxa494", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_Female_OneShot3D", display: "Melee Takedown Attacker Female OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_Female_OneShot3D, key: "sxa495", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_GrabShoulder_OneShot2D", display: "Melee Takedown Attacker GrabShoulder OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_GrabShoulder_OneShot2D, key: "sxa496", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_GrabShoulder_OneShot3D", display: "Melee Takedown Attacker GrabShoulder OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_GrabShoulder_OneShot3D, key: "sxa497", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_KnifePullOutFrontBody_Fast_OneShot2D", display: "Melee Takedown Attacker KnifePullOutFrontBody Fast OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_KnifePullOutFrontBody_Fast_OneShot2D, key: "sxa498", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_KnifePullOutFrontBody_Fast_OneShot3D", display: "Melee Takedown Attacker KnifePullOutFrontBody Fast OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_KnifePullOutFrontBody_Fast_OneShot3D, key: "sxa499", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_KnifeStabFrontBody_Fast_OneShot2D", display: "Melee Takedown Attacker KnifeStabFrontBody Fast OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_KnifeStabFrontBody_Fast_OneShot2D, key: "sxa500", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_KnifeStabFrontBody_Fast_OneShot3D", display: "Melee Takedown Attacker KnifeStabFrontBody Fast OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_KnifeStabFrontBody_Fast_OneShot3D, key: "sxa501", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_Male_OneShot2D", display: "Melee Takedown Attacker Male OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_Male_OneShot2D, key: "sxa502", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_Male_OneShot3D", display: "Melee Takedown Attacker Male OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_Male_OneShot3D, key: "sxa503", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_SledgehammerHit_OneShot2D", display: "Melee Takedown Attacker SledgehammerHit OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_SledgehammerHit_OneShot2D, key: "sxa504", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_SledgehammerHit_OneShot3D", display: "Melee Takedown Attacker SledgehammerHit OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_SledgehammerHit_OneShot3D, key: "sxa505", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_SledgehammerSwing_OneShot2D", display: "Melee Takedown Attacker SledgehammerSwing OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_SledgehammerSwing_OneShot2D, key: "sxa506", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_SledgehammerSwing_OneShot3D", display: "Melee Takedown Attacker SledgehammerSwing OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_SledgehammerSwing_OneShot3D, key: "sxa507", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_StartKnifeGrabShoulder_OneShot2D", display: "Melee Takedown Attacker StartKnifeGrabShoulder OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_StartKnifeGrabShoulder_OneShot2D, key: "sxa508", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_StartKnifeGrabShoulder_OneShot3D", display: "Melee Takedown Attacker StartKnifeGrabShoulder OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_StartKnifeGrabShoulder_OneShot3D, key: "sxa509", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_StartSledgehammerGrabShoulder_OneShot2D", display: "Melee Takedown Attacker StartSledgehammerGrabShoulder OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_StartSledgehammerGrabShoulder_OneShot2D, key: "sxa510", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Attacker_StartSledgehammerGrabShoulder_OneShot3D", display: "Melee Takedown Attacker StartSledgehammerGrabShoulder OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Attacker_StartSledgehammerGrabShoulder_OneShot3D, key: "sxa511", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_HurtHigh_Female_OneShot2D", display: "Melee Takedown HurtHigh Female OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_HurtHigh_Female_OneShot2D, key: "sxa512", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_HurtHigh_Female_OneShot3D", display: "Melee Takedown HurtHigh Female OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_HurtHigh_Female_OneShot3D, key: "sxa513", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_HurtHigh_Male_OneShot2D", display: "Melee Takedown HurtHigh Male OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_HurtHigh_Male_OneShot2D, key: "sxa514", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_HurtHigh_Male_OneShot3D", display: "Melee Takedown HurtHigh Male OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_HurtHigh_Male_OneShot3D, key: "sxa515", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_PanicScream_Female_OneShot2D", display: "Melee Takedown PanicScream Female OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_PanicScream_Female_OneShot2D, key: "sxa516", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_PanicScream_Female_OneShot3D", display: "Melee Takedown PanicScream Female OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_PanicScream_Female_OneShot3D, key: "sxa517", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_PanicScream_Male_OneShot2D", display: "Melee Takedown PanicScream Male OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_PanicScream_Male_OneShot2D, key: "sxa518", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_PanicScream_Male_OneShot3D", display: "Melee Takedown PanicScream Male OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_PanicScream_Male_OneShot3D, key: "sxa519", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Struggle_Female_OneShot2D", display: "Melee Takedown Struggle Female OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Struggle_Female_OneShot2D, key: "sxa520", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Struggle_Female_OneShot3D", display: "Melee Takedown Struggle Female OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Struggle_Female_OneShot3D, key: "sxa521", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Struggle_Male_OneShot2D", display: "Melee Takedown Struggle Male OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Struggle_Male_OneShot2D, key: "sxa522", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Struggle_Male_OneShot3D", display: "Melee Takedown Struggle Male OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Struggle_Male_OneShot3D, key: "sxa523", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_ThroatSlice_Female_OneShot2D", display: "Melee Takedown ThroatSlice Female OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_ThroatSlice_Female_OneShot2D, key: "sxa524", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_ThroatSlice_Female_OneShot3D", display: "Melee Takedown ThroatSlice Female OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_ThroatSlice_Female_OneShot3D, key: "sxa525", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_ThroatSlice_Male_OneShot2D", display: "Melee Takedown ThroatSlice Male OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_ThroatSlice_Male_OneShot2D, key: "sxa526", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_ThroatSlice_Male_OneShot3D", display: "Melee Takedown ThroatSlice Male OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_ThroatSlice_Male_OneShot3D, key: "sxa527", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Victim_FallToGround_OneShot2D", display: "Melee Takedown Victim FallToGround OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2560, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Victim_FallToGround_OneShot2D, key: "sxa528", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Victim_FallToGround_OneShot3D", display: "Melee Takedown Victim FallToGround OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2610, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Victim_FallToGround_OneShot3D, key: "sxa529", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Victim_TurnAround_SlowShort_OneShot2D", display: "Melee Takedown Victim TurnAround SlowShort OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Victim_TurnAround_SlowShort_OneShot2D, key: "sxa530", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_Takedown_Victim_TurnAround_SlowShort_OneShot3D", display: "Melee Takedown Victim TurnAround SlowShort OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_Takedown_Victim_TurnAround_SlowShort_OneShot3D, key: "sxa531", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_WorldHit_OneShot2D", display: "Melee WorldHit OneShot2D", category: "Soldier_Melee", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_WorldHit_OneShot2D, key: "sxa532", catKey: "sxg36" },
{ name: "SFX_Soldier_Melee_WorldHit_OneShot3D", display: "Melee WorldHit OneShot3D", category: "Soldier_Melee", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Melee_WorldHit_OneShot3D, key: "sxa533", catKey: "sxg36" },
{ name: "SFX_Soldier_Movement_CameraNoise_OneShot2D", display: "Movement CameraNoise OneShot2D", category: "Soldier_Movement", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_CameraNoise_OneShot2D, key: "sxa534", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Drag_Grab_OneShot3D", display: "Movement Drag Grab OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Drag_Grab_OneShot3D, key: "sxa535", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Drag_Release_OneShot2D", display: "Movement Drag Release OneShot2D", category: "Soldier_Movement", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Drag_Release_OneShot2D, key: "sxa536", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Drag_Release_OneShot3D", display: "Movement Drag Release OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Drag_Release_OneShot3D, key: "sxa537", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Efforts_Breathing_Soldier_SimpleLoop2D", display: "Movement Efforts Breathing Soldier SimpleLoop2D", category: "Soldier_Movement", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Efforts_Breathing_Soldier_SimpleLoop2D, key: "sxa538", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Efforts_Breathing_Soldier_SimpleLoop3D", display: "Movement Efforts Breathing Soldier SimpleLoop3D", category: "Soldier_Movement", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Efforts_Breathing_Soldier_SimpleLoop3D, key: "sxa539", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Efforts_Breathing_SoldierFemale_SimpleLoop2D", display: "Movement Efforts Breathing SoldierFemale SimpleLoop2D", category: "Soldier_Movement", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Efforts_Breathing_SoldierFemale_SimpleLoop2D, key: "sxa540", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Efforts_Breathing_SoldierFemale_SimpleLoop3D", display: "Movement Efforts Breathing SoldierFemale SimpleLoop3D", category: "Soldier_Movement", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Efforts_Breathing_SoldierFemale_SimpleLoop3D, key: "sxa541", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Efforts_Breathing_SoldierMale_LoopStop_Loop2D", display: "Movement Efforts Breathing SoldierMale LoopStop Loop2D", category: "Soldier_Movement", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Efforts_Breathing_SoldierMale_LoopStop_Loop2D, key: "sxa542", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Efforts_Breathing_SoldierMale_LoopStop_Loop3D", display: "Movement Efforts Breathing SoldierMale LoopStop Loop3D", category: "Soldier_Movement", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Efforts_Breathing_SoldierMale_LoopStop_Loop3D, key: "sxa543", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Efforts_Breathing_SoldierMale_SimpleLoop2D", display: "Movement Efforts Breathing SoldierMale SimpleLoop2D", category: "Soldier_Movement", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Efforts_Breathing_SoldierMale_SimpleLoop2D, key: "sxa544", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Efforts_Breathing_SoldierMale_SimpleLoop3D", display: "Movement Efforts Breathing SoldierMale SimpleLoop3D", category: "Soldier_Movement", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Efforts_Breathing_SoldierMale_SimpleLoop3D, key: "sxa545", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Efforts_CockpitEject_OneShot3D", display: "Movement Efforts CockpitEject OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Efforts_CockpitEject_OneShot3D, key: "sxa546", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Efforts_Crouch_Female_OneShot2D", display: "Movement Efforts Crouch Female OneShot2D", category: "Soldier_Movement", kind: "oneshot", dim: "2d", windowMs: 7470, lengthText: "6.5s", lengthKey: "sxl65", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Efforts_Crouch_Female_OneShot2D, key: "sxa547", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Efforts_Crouch_Female_OneShot3D", display: "Movement Efforts Crouch Female OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 7780, lengthText: "6.8s", lengthKey: "sxl68", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Efforts_Crouch_Female_OneShot3D, key: "sxa548", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Efforts_Crouch_Male_OneShot2D", display: "Movement Efforts Crouch Male OneShot2D", category: "Soldier_Movement", kind: "oneshot", dim: "2d", windowMs: 9830, lengthText: "8.8s", lengthKey: "sxl88", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Efforts_Crouch_Male_OneShot2D, key: "sxa549", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Efforts_Crouch_Male_OneShot3D", display: "Movement Efforts Crouch Male OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 7520, lengthText: "6.5s", lengthKey: "sxl65", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Efforts_Crouch_Male_OneShot3D, key: "sxa550", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Foley_ProneMovement_OneShot3D", display: "Movement Foley ProneMovement OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 4190, lengthText: "3.2s", lengthKey: "sxl32", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Foley_ProneMovement_OneShot3D, key: "sxa551", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Foley_WeaponAdd_AR_Mount_OneShot3D", display: "Movement Foley WeaponAdd AR Mount OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Foley_WeaponAdd_AR_Mount_OneShot3D, key: "sxa552", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Foley_WeaponAdd_LMGMag_Mount_OneShot3D", display: "Movement Foley WeaponAdd LMGMag Mount OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Foley_WeaponAdd_LMGMag_Mount_OneShot3D, key: "sxa553", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Foley_WeaponAdd_Shotgun_Mount_OneShot3D", display: "Movement Foley WeaponAdd Shotgun Mount OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Foley_WeaponAdd_Shotgun_Mount_OneShot3D, key: "sxa554", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Foley_WeaponAdd_SMG_Mount_OneShot3D", display: "Movement Foley WeaponAdd SMG Mount OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Foley_WeaponAdd_SMG_Mount_OneShot3D, key: "sxa555", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Foley_WeaponAdd_Sniper_Mount_OneShot3D", display: "Movement Foley WeaponAdd Sniper Mount OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Foley_WeaponAdd_Sniper_Mount_OneShot3D, key: "sxa556", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Slide_FoleyEnd_OneShot3D", display: "Movement Slide FoleyEnd OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Slide_FoleyEnd_OneShot3D, key: "sxa557", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Slide_FoleyStart_OneShot3D", display: "Movement Slide FoleyStart OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Slide_FoleyStart_OneShot3D, key: "sxa558", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Water_Splash_OneShot3D", display: "Movement Water Splash OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 4000, lengthText: "3.0s", lengthKey: "sxl30", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Water_Splash_OneShot3D, key: "sxa559", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Water_Swim_ArmStroke_OneShot3D", display: "Movement Water Swim ArmStroke OneShot3D", category: "Soldier_Movement", kind: "oneshot", dim: "3d", windowMs: 4980, lengthText: "4.0s", lengthKey: "sxl40", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Water_Swim_ArmStroke_OneShot3D, key: "sxa560", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Water_Swim_FootStroke_Surface_SimpleLoop2D", display: "Movement Water Swim FootStroke Surface SimpleLoop2D", category: "Soldier_Movement", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Water_Swim_FootStroke_Surface_SimpleLoop2D, key: "sxa561", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Water_Swim_FootStroke_Surface_SimpleLoop3D", display: "Movement Water Swim FootStroke Surface SimpleLoop3D", category: "Soldier_Movement", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Water_Swim_FootStroke_Surface_SimpleLoop3D, key: "sxa562", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Water_Swim_FootStroke_Underwater_SimpleLoop2D", display: "Movement Water Swim FootStroke Underwater SimpleLoop2D", category: "Soldier_Movement", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Water_Swim_FootStroke_Underwater_SimpleLoop2D, key: "sxa563", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Water_Swim_FootStroke_Underwater_SimpleLoop3D", display: "Movement Water Swim FootStroke Underwater SimpleLoop3D", category: "Soldier_Movement", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Water_Swim_FootStroke_Underwater_SimpleLoop3D, key: "sxa564", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Water_Wade_Sprint_SimpleLoop3D", display: "Movement Water Wade Sprint SimpleLoop3D", category: "Soldier_Movement", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Water_Wade_Sprint_SimpleLoop3D, key: "sxa565", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Water_Wade_Walk_SimpleLoop3D", display: "Movement Water Wade Walk SimpleLoop3D", category: "Soldier_Movement", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Water_Wade_Walk_SimpleLoop3D, key: "sxa566", catKey: "sxg37" },
{ name: "SFX_Soldier_Movement_Wind_SimpleLoop3D", display: "Movement Wind SimpleLoop3D", category: "Soldier_Movement", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Movement_Wind_SimpleLoop3D, key: "sxa567", catKey: "sxg37" },
{ name: "SFX_Soldier_Parachute_Cut_OneShot3D", display: "Parachute Cut OneShot3D", category: "Soldier_Parachute", kind: "oneshot", dim: "3d", windowMs: 3630, lengthText: "2.6s", lengthKey: "sxl26", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Parachute_Cut_OneShot3D, key: "sxa568", catKey: "sxg38" },
{ name: "SFX_Soldier_Parachute_Deploy_Effort_Female_OneShot2D", display: "Parachute Deploy Effort Female OneShot2D", category: "Soldier_Parachute", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Parachute_Deploy_Effort_Female_OneShot2D, key: "sxa569", catKey: "sxg38" },
{ name: "SFX_Soldier_Parachute_Deploy_Effort_Female_OneShot3D", display: "Parachute Deploy Effort Female OneShot3D", category: "Soldier_Parachute", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Parachute_Deploy_Effort_Female_OneShot3D, key: "sxa570", catKey: "sxg38" },
{ name: "SFX_Soldier_Parachute_Deploy_Effort_Male_OneShot2D", display: "Parachute Deploy Effort Male OneShot2D", category: "Soldier_Parachute", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Parachute_Deploy_Effort_Male_OneShot2D, key: "sxa571", catKey: "sxg38" },
{ name: "SFX_Soldier_Parachute_Deploy_Effort_Male_OneShot3D", display: "Parachute Deploy Effort Male OneShot3D", category: "Soldier_Parachute", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Parachute_Deploy_Effort_Male_OneShot3D, key: "sxa572", catKey: "sxg38" },
{ name: "SFX_Soldier_Parachute_Deploy_OneShot3D", display: "Parachute Deploy OneShot3D", category: "Soldier_Parachute", kind: "oneshot", dim: "3d", windowMs: 4690, lengthText: "3.7s", lengthKey: "sxl37", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Parachute_Deploy_OneShot3D, key: "sxa573", catKey: "sxg38" },
{ name: "SFX_Soldier_Parachute_Glide_SimpleLoop3D", display: "Parachute Glide SimpleLoop3D", category: "Soldier_Parachute", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Parachute_Glide_SimpleLoop3D, key: "sxa574", catKey: "sxg38" },
{ name: "SFX_Soldier_Parachute_Land_OneShot3D", display: "Parachute Land OneShot3D", category: "Soldier_Parachute", kind: "oneshot", dim: "3d", windowMs: 3590, lengthText: "2.6s", lengthKey: "sxl26", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Parachute_Land_OneShot3D, key: "sxa575", catKey: "sxg38" },
{ name: "SFX_Soldier_Parachute_Rain_SimpleLoop3D", display: "Parachute Rain SimpleLoop3D", category: "Soldier_Parachute", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Parachute_Rain_SimpleLoop3D, key: "sxa576", catKey: "sxg38" },
{ name: "SFX_Soldier_Parachute_ToggleGrab_OneShot3D", display: "Parachute ToggleGrab OneShot3D", category: "Soldier_Parachute", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Parachute_ToggleGrab_OneShot3D, key: "sxa577", catKey: "sxg38" },
{ name: "SFX_Soldier_Parachute_TogglePull_OneShot3D", display: "Parachute TogglePull OneShot3D", category: "Soldier_Parachute", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Parachute_TogglePull_OneShot3D, key: "sxa578", catKey: "sxg38" },
{ name: "SFX_Soldier_Parachute_ToggleRelease_OneShot3D", display: "Parachute ToggleRelease OneShot3D", category: "Soldier_Parachute", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Parachute_ToggleRelease_OneShot3D, key: "sxa579", catKey: "sxg38" },
{ name: "SFX_Soldier_Ragdoll_OnDeath_OneShot3D", display: "Ragdoll OnDeath OneShot3D", category: "Soldier_Ragdoll", kind: "oneshot", dim: "3d", windowMs: 2560, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Ragdoll_OnDeath_OneShot3D, key: "sxa580", catKey: "sxg39" },
{ name: "SFX_Soldier_Revive_BeingRevived_OneShot2D", display: "Revive BeingRevived OneShot2D", category: "Soldier_Revive", kind: "oneshot", dim: "2d", windowMs: 2570, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_BeingRevived_OneShot2D, key: "sxa581", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_BeingRevived_OneShot3D", display: "Revive BeingRevived OneShot3D", category: "Soldier_Revive", kind: "oneshot", dim: "3d", windowMs: 2570, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_BeingRevived_OneShot3D, key: "sxa582", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_Effort_FemaleHurt_OneShot2D", display: "Revive Effort FemaleHurt OneShot2D", category: "Soldier_Revive", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_Effort_FemaleHurt_OneShot2D, key: "sxa583", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_Effort_FemaleHurt_OneShot3D", display: "Revive Effort FemaleHurt OneShot3D", category: "Soldier_Revive", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_Effort_FemaleHurt_OneShot3D, key: "sxa584", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_Effort_MaleEpipenStab_OneShot3D", display: "Revive Effort MaleEpipenStab OneShot3D", category: "Soldier_Revive", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_Effort_MaleEpipenStab_OneShot3D, key: "sxa585", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_Effort_MaleHurt_OneShot3D", display: "Revive Effort MaleHurt OneShot3D", category: "Soldier_Revive", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_Effort_MaleHurt_OneShot3D, key: "sxa586", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_Effort_MaleNoseBreathing_End_OneShot3D", display: "Revive Effort MaleNoseBreathing End OneShot3D", category: "Soldier_Revive", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_Effort_MaleNoseBreathing_End_OneShot3D, key: "sxa587", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_Epipen_Prepare_Distant_OneShot3D", display: "Revive Epipen Prepare Distant OneShot3D", category: "Soldier_Revive", kind: "oneshot", dim: "3d", windowMs: 10410, lengthText: "9.4s", lengthKey: "sxl94", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_Epipen_Prepare_Distant_OneShot3D, key: "sxa588", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_Epipen_Prepare_OneShot3D", display: "Revive Epipen Prepare OneShot3D", category: "Soldier_Revive", kind: "oneshot", dim: "3d", windowMs: 10620, lengthText: "9.6s", lengthKey: "sxl96", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_Epipen_Prepare_OneShot3D, key: "sxa589", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_FemaleNoseBreathingLoop_SimpleLoop2D", display: "Revive FemaleNoseBreathingLoop SimpleLoop2D", category: "Soldier_Revive", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_FemaleNoseBreathingLoop_SimpleLoop2D, key: "sxa590", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_FemaleNoseBreathingLoop_SimpleLoop3D", display: "Revive FemaleNoseBreathingLoop SimpleLoop3D", category: "Soldier_Revive", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_FemaleNoseBreathingLoop_SimpleLoop3D, key: "sxa591", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_GettingRevived_BreathFemale_SimpleLoop2D", display: "Revive GettingRevived BreathFemale SimpleLoop2D", category: "Soldier_Revive", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_GettingRevived_BreathFemale_SimpleLoop2D, key: "sxa592", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_GettingRevived_BreathFemale_SimpleLoop3D", display: "Revive GettingRevived BreathFemale SimpleLoop3D", category: "Soldier_Revive", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_GettingRevived_BreathFemale_SimpleLoop3D, key: "sxa593", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_GettingRevived_SimpleLoop3D", display: "Revive GettingRevived SimpleLoop3D", category: "Soldier_Revive", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_GettingRevived_SimpleLoop3D, key: "sxa594", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_MaleNoseBreathingLoop_SimpleLoop2D", display: "Revive MaleNoseBreathingLoop SimpleLoop2D", category: "Soldier_Revive", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_MaleNoseBreathingLoop_SimpleLoop2D, key: "sxa595", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_MaleNoseBreathingLoop_SimpleLoop3D", display: "Revive MaleNoseBreathingLoop SimpleLoop3D", category: "Soldier_Revive", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_MaleNoseBreathingLoop_SimpleLoop3D, key: "sxa596", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_Revived_Foley_OneShot3D", display: "Revive Revived Foley OneShot3D", category: "Soldier_Revive", kind: "oneshot", dim: "3d", windowMs: 2870, lengthText: "1.9s", lengthKey: "sxl19", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_Revived_Foley_OneShot3D, key: "sxa597", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_Revived_SimpleLoop3D", display: "Revive Revived SimpleLoop3D", category: "Soldier_Revive", kind: "loop", dim: "3d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_Revived_SimpleLoop3D, key: "sxa598", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_RevivedBreath_OneShot3D", display: "Revive RevivedBreath OneShot3D", category: "Soldier_Revive", kind: "oneshot", dim: "3d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_RevivedBreath_OneShot3D, key: "sxa599", catKey: "sxg40" },
{ name: "SFX_Soldier_Revive_Start_OneShot3D", display: "Revive Start OneShot3D", category: "Soldier_Revive", kind: "oneshot", dim: "3d", windowMs: 4630, lengthText: "3.6s", lengthKey: "sxl36", asset: mod.RuntimeSpawn_Common.SFX_Soldier_Revive_Start_OneShot3D, key: "sxa600", catKey: "sxg40" },
{ name: "SFX_Soldier_States_Local_Underwater_SimpleLoop2D", display: "States Local Underwater SimpleLoop2D", category: "Soldier_States", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_Soldier_States_Local_Underwater_SimpleLoop2D, key: "sxa601", catKey: "sxg41" },
{ name: "SFX_Soldier_States_Local_UnderwaterTransition_In_OneShot2D", display: "States Local UnderwaterTransition In OneShot2D", category: "Soldier_States", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_Soldier_States_Local_UnderwaterTransition_In_OneShot2D, key: "sxa602", catKey: "sxg41" },
{ name: "SFX_Soldier_States_Local_UnderwaterTransition_Out_OneShot2D", display: "States Local UnderwaterTransition Out OneShot2D", category: "Soldier_States", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_Soldier_States_Local_UnderwaterTransition_Out_OneShot2D, key: "sxa603", catKey: "sxg41" },
{ name: "SFX_UI_Commorose_OnClose_OneShot2D", display: "Commorose OnClose OneShot2D", category: "UI_Commorose", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Commorose_OnClose_OneShot2D, key: "sxa604", catKey: "sxg42" },
{ name: "SFX_UI_Commorose_OnOpen_OneShot2D", display: "Commorose OnOpen OneShot2D", category: "UI_Commorose", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_Commorose_OnOpen_OneShot2D, key: "sxa605", catKey: "sxg42" },
{ name: "SFX_UI_Deploy_Screen_ActionSuccess_OneShot2D", display: "Deploy Screen ActionSuccess OneShot2D", category: "UI_Deploy", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Deploy_Screen_ActionSuccess_OneShot2D, key: "sxa606", catKey: "sxg43" },
{ name: "SFX_UI_Deploy_Screen_FadeIn_OneShot2D", display: "Deploy Screen FadeIn OneShot2D", category: "UI_Deploy", kind: "oneshot", dim: "2d", windowMs: 3030, lengthText: "2.0s", lengthKey: "sxl20", asset: mod.RuntimeSpawn_Common.SFX_UI_Deploy_Screen_FadeIn_OneShot2D, key: "sxa607", catKey: "sxg43" },
{ name: "SFX_UI_Deploy_Screen_VehicleAvailable_OneShot2D", display: "Deploy Screen VehicleAvailable OneShot2D", category: "UI_Deploy", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_Deploy_Screen_VehicleAvailable_OneShot2D, key: "sxa608", catKey: "sxg43" },
{ name: "SFX_UI_EOR_Counting_SimpleLoop2D", display: "EOR Counting SimpleLoop2D", category: "UI_EOR", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_UI_EOR_Counting_SimpleLoop2D, key: "sxa609", catKey: "sxg44" },
{ name: "SFX_UI_EOR_MasteryRankUp_OneShot2D", display: "EOR MasteryRankUp OneShot2D", category: "UI_EOR", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_EOR_MasteryRankUp_OneShot2D, key: "sxa610", catKey: "sxg44" },
{ name: "SFX_UI_EOR_NavigationTab_OneShot2D", display: "EOR NavigationTab OneShot2D", category: "UI_EOR", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_EOR_NavigationTab_OneShot2D, key: "sxa611", catKey: "sxg44" },
{ name: "SFX_UI_EOR_RankUp_Extra_OneShot2D", display: "EOR RankUp Extra OneShot2D", category: "UI_EOR", kind: "oneshot", dim: "2d", windowMs: 4420, lengthText: "3.4s", lengthKey: "sxl34", asset: mod.RuntimeSpawn_Common.SFX_UI_EOR_RankUp_Extra_OneShot2D, key: "sxa612", catKey: "sxg44" },
{ name: "SFX_UI_EOR_RankUp_Normal_OneShot2D", display: "EOR RankUp Normal OneShot2D", category: "UI_EOR", kind: "oneshot", dim: "2d", windowMs: 2860, lengthText: "1.9s", lengthKey: "sxl19", asset: mod.RuntimeSpawn_Common.SFX_UI_EOR_RankUp_Normal_OneShot2D, key: "sxa613", catKey: "sxg44" },
{ name: "SFX_UI_EOR_RoundOutcome_OneShot2D", display: "EOR RoundOutcome OneShot2D", category: "UI_EOR", kind: "oneshot", dim: "2d", windowMs: 4380, lengthText: "3.4s", lengthKey: "sxl34", asset: mod.RuntimeSpawn_Common.SFX_UI_EOR_RoundOutcome_OneShot2D, key: "sxa614", catKey: "sxg44" },
{ name: "SFX_UI_EOR_Vehicles_Abrams_OneShot_OneShot2D", display: "EOR Vehicles Abrams OneShot OneShot2D", category: "UI_EOR", kind: "oneshot", dim: "2d", windowMs: 7580, lengthText: "6.6s", lengthKey: "sxl66", asset: mod.RuntimeSpawn_Common.SFX_UI_EOR_Vehicles_Abrams_OneShot_OneShot2D, key: "sxa615", catKey: "sxg44" },
{ name: "SFX_UI_EOR_Vehicles_JetFlyBy_OneShot2D", display: "EOR Vehicles JetFlyBy OneShot2D", category: "UI_EOR", kind: "oneshot", dim: "2d", windowMs: 8980, lengthText: "8.0s", lengthKey: "sxl80", asset: mod.RuntimeSpawn_Common.SFX_UI_EOR_Vehicles_JetFlyBy_OneShot2D, key: "sxa616", catKey: "sxg44" },
{ name: "SFX_UI_EOR_XP_OneShot2D", display: "EOR XP OneShot2D", category: "UI_EOR", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_EOR_XP_OneShot2D, key: "sxa617", catKey: "sxg44" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_AreaUnlock_OneShot2D", display: "Gamemode Shared CaptureObjectives AreaUnlock OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 4490, lengthText: "3.5s", lengthKey: "sxl35", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_AreaUnlock_OneShot2D, key: "sxa618", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinEnemy_OneShot2D", display: "Gamemode Shared CaptureObjectives CaptureLeadinEnemy OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 7140, lengthText: "6.1s", lengthKey: "sxl61", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinEnemy_OneShot2D, key: "sxa619", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinFriendly_OneShot2D", display: "Gamemode Shared CaptureObjectives CaptureLeadinFriendly OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 7150, lengthText: "6.2s", lengthKey: "sxl62", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinFriendly_OneShot2D, key: "sxa620", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinNeutral_OneShot2D", display: "Gamemode Shared CaptureObjectives CaptureLeadinNeutral OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 7830, lengthText: "6.8s", lengthKey: "sxl68", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinNeutral_OneShot2D, key: "sxa621", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinThump_OneShot2D", display: "Gamemode Shared CaptureObjectives CaptureLeadinThump OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureLeadinThump_OneShot2D, key: "sxa622", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureNeutralize_OneShot2D", display: "Gamemode Shared CaptureObjectives CaptureNeutralize OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureNeutralize_OneShot2D, key: "sxa623", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureStartedByEnemy_OneShot2D", display: "Gamemode Shared CaptureObjectives CaptureStartedByEnemy OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureStartedByEnemy_OneShot2D, key: "sxa624", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureStartedByFriendly_OneShot2D", display: "Gamemode Shared CaptureObjectives CaptureStartedByFriendly OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CaptureStartedByFriendly_OneShot2D, key: "sxa625", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingDroneEnemy_SimpleLoop2D", display: "Gamemode Shared CaptureObjectives CapturingDroneEnemy SimpleLoop2D", category: "UI_Gamemode", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingDroneEnemy_SimpleLoop2D, key: "sxa626", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingDroneFriendly_SimpleLoop2D", display: "Gamemode Shared CaptureObjectives CapturingDroneFriendly SimpleLoop2D", category: "UI_Gamemode", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingDroneFriendly_SimpleLoop2D, key: "sxa627", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingThumpEnemy_OneShot2D", display: "Gamemode Shared CaptureObjectives CapturingThumpEnemy OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingThumpEnemy_OneShot2D, key: "sxa628", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingThumpFriendly_OneShot2D", display: "Gamemode Shared CaptureObjectives CapturingThumpFriendly OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingThumpFriendly_OneShot2D, key: "sxa629", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTick_IsEnemy_SimpleLoop2D", display: "Gamemode Shared CaptureObjectives CapturingTick IsEnemy SimpleLoop2D", category: "UI_Gamemode", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTick_IsEnemy_SimpleLoop2D, key: "sxa630", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTick_IsFriendly_SimpleLoop2D", display: "Gamemode Shared CaptureObjectives CapturingTick IsFriendly SimpleLoop2D", category: "UI_Gamemode", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTick_IsFriendly_SimpleLoop2D, key: "sxa631", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickEnemy_OneShot2D", display: "Gamemode Shared CaptureObjectives CapturingTickEnemy OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickEnemy_OneShot2D, key: "sxa632", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickFriendly_OneShot2D", display: "Gamemode Shared CaptureObjectives CapturingTickFriendly OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickFriendly_OneShot2D, key: "sxa633", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickIcon_IsFriendly_OneShot2D", display: "Gamemode Shared CaptureObjectives CapturingTickIcon IsFriendly OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickIcon_IsFriendly_OneShot2D, key: "sxa634", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickInBetweenEnemy_OneShot2D", display: "Gamemode Shared CaptureObjectives CapturingTickInBetweenEnemy OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickInBetweenEnemy_OneShot2D, key: "sxa635", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickInBetweenFriendly_OneShot2D", display: "Gamemode Shared CaptureObjectives CapturingTickInBetweenFriendly OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_CapturingTickInBetweenFriendly_OneShot2D, key: "sxa636", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_ObjectiveOnEnter_OneShot2D", display: "Gamemode Shared CaptureObjectives ObjectiveOnEnter OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_ObjectiveOnEnter_OneShot2D, key: "sxa637", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_ObjectiveOnExit_OneShot2D", display: "Gamemode Shared CaptureObjectives ObjectiveOnExit OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_ObjectiveOnExit_OneShot2D, key: "sxa638", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_ObjetiveUnlockCountdownRiser_OneShot2D", display: "Gamemode Shared CaptureObjectives ObjetiveUnlockCountdownRiser OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 15000, lengthText: "10s+", lengthKey: "sxl10p", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_ObjetiveUnlockCountdownRiser_OneShot2D, key: "sxa639", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_ObjetiveUnlockCountdownTick_OneShot2D", display: "Gamemode Shared CaptureObjectives ObjetiveUnlockCountdownTick OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_ObjetiveUnlockCountdownTick_OneShot2D, key: "sxa640", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_ObjetiveUnlockReveal_OneShot2D", display: "Gamemode Shared CaptureObjectives ObjetiveUnlockReveal OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 3550, lengthText: "2.6s", lengthKey: "sxl26", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_ObjetiveUnlockReveal_OneShot2D, key: "sxa641", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_OnCapturedByFriendly_OneShot2D", display: "Gamemode Shared CaptureObjectives OnCapturedByFriendly OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 5420, lengthText: "4.4s", lengthKey: "sxl44", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_OnCapturedByFriendly_OneShot2D, key: "sxa642", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_OnContested_OneShot2D", display: "Gamemode Shared CaptureObjectives OnContested OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_OnContested_OneShot2D, key: "sxa643", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_CaptureObjectives_OnContested_SimpleLoop2D", display: "Gamemode Shared CaptureObjectives OnContested SimpleLoop2D", category: "UI_Gamemode", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_CaptureObjectives_OnContested_SimpleLoop2D, key: "sxa644", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_Intro_Countdown_Final_OneShot2D", display: "Gamemode Shared Intro Countdown Final OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_Intro_Countdown_Final_OneShot2D, key: "sxa645", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_Intro_Countdown_OneShot2D", display: "Gamemode Shared Intro Countdown OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_Intro_Countdown_OneShot2D, key: "sxa646", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_Intro_FinalImpact_OneShot2D", display: "Gamemode Shared Intro FinalImpact OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 5550, lengthText: "4.6s", lengthKey: "sxl46", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_Intro_FinalImpact_OneShot2D, key: "sxa647", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_Intro_Reveal_OneShot2D", display: "Gamemode Shared Intro Reveal OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 4170, lengthText: "3.2s", lengthKey: "sxl32", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_Intro_Reveal_OneShot2D, key: "sxa648", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_Intro_TransitionToCountdown_OneShot2D", display: "Gamemode Shared Intro TransitionToCountdown OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_Intro_TransitionToCountdown_OneShot2D, key: "sxa649", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_LeadChange_Negative_OneShot2D", display: "Gamemode Shared LeadChange Negative OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_LeadChange_Negative_OneShot2D, key: "sxa650", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_LeadChange_Positive_OneShot2D", display: "Gamemode Shared LeadChange Positive OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_LeadChange_Positive_OneShot2D, key: "sxa651", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_OutOfBounds_Countdown_OneShot2D", display: "Gamemode Shared OutOfBounds Countdown OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_OutOfBounds_Countdown_OneShot2D, key: "sxa652", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_OutOfBounds_ReturnAreaEcho_OneShot2D", display: "Gamemode Shared OutOfBounds ReturnAreaEcho OneShot2D", category: "UI_Gamemode", kind: "oneshot", dim: "2d", windowMs: 14990, lengthText: "10s+", lengthKey: "sxl10p", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_OutOfBounds_ReturnAreaEcho_OneShot2D, key: "sxa653", catKey: "sxg45" },
{ name: "SFX_UI_Gamemode_Shared_OutOfBounds_SFXLoop_SimpleLoop2D", display: "Gamemode Shared OutOfBounds SFXLoop SimpleLoop2D", category: "UI_Gamemode", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_UI_Gamemode_Shared_OutOfBounds_SFXLoop_SimpleLoop2D, key: "sxa654", catKey: "sxg45" },
{ name: "SFX_UI_Gauntlet_Beacons_BeaconPickup_OneShot2D", display: "Gauntlet Beacons BeaconPickup OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Beacons_BeaconPickup_OneShot2D, key: "sxa655", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Beacons_CalibrationBegin_OneShot2D", display: "Gauntlet Beacons CalibrationBegin OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2920, lengthText: "1.9s", lengthKey: "sxl19", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Beacons_CalibrationBegin_OneShot2D, key: "sxa656", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Beacons_CalibrationComplete_OneShot2D", display: "Gauntlet Beacons CalibrationComplete OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3440, lengthText: "2.4s", lengthKey: "sxl24", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Beacons_CalibrationComplete_OneShot2D, key: "sxa657", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Beacons_CalibrationTick_OneShot2D", display: "Gauntlet Beacons CalibrationTick OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Beacons_CalibrationTick_OneShot2D, key: "sxa658", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Beacons_CalibrationTickUrgency_OneShot2D", display: "Gauntlet Beacons CalibrationTickUrgency OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Beacons_CalibrationTickUrgency_OneShot2D, key: "sxa659", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Beacons_Drop_OneShot2D", display: "Gauntlet Beacons Drop OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3000, lengthText: "2.0s", lengthKey: "sxl20", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Beacons_Drop_OneShot2D, key: "sxa660", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Beacons_EnemyCalibrationBeeping_OneShot2D", display: "Gauntlet Beacons EnemyCalibrationBeeping OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Beacons_EnemyCalibrationBeeping_OneShot2D, key: "sxa661", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Beacons_SignalLost_OneShot2D", display: "Gauntlet Beacons SignalLost OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Beacons_SignalLost_OneShot2D, key: "sxa662", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Circuit_ChainStateChange_OneShot2D", display: "Gauntlet Circuit ChainStateChange OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Circuit_ChainStateChange_OneShot2D, key: "sxa663", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Circuit_TerminalCaptured_OneShot2D", display: "Gauntlet Circuit TerminalCaptured OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Circuit_TerminalCaptured_OneShot2D, key: "sxa664", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Circuit_TerminalCaptureLoop_SimpleLoop2D", display: "Gauntlet Circuit TerminalCaptureLoop SimpleLoop2D", category: "UI_Gauntlet", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Circuit_TerminalCaptureLoop_SimpleLoop2D, key: "sxa665", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Circuit_TerminalCaptureStart_OneShot2D", display: "Gauntlet Circuit TerminalCaptureStart OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Circuit_TerminalCaptureStart_OneShot2D, key: "sxa666", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Circuit_TerminalCaptureStop_OneShot2D", display: "Gauntlet Circuit TerminalCaptureStop OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Circuit_TerminalCaptureStop_OneShot2D, key: "sxa667", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Circuit_TerminalEnemyCapturing_OneShot2D", display: "Gauntlet Circuit TerminalEnemyCapturing OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Circuit_TerminalEnemyCapturing_OneShot2D, key: "sxa668", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Circuit_TerminalFriendlyCapturing_OneShot2D", display: "Gauntlet Circuit TerminalFriendlyCapturing OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Circuit_TerminalFriendlyCapturing_OneShot2D, key: "sxa669", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Circuit_TerminalLost_OneShot2D", display: "Gauntlet Circuit TerminalLost OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2780, lengthText: "1.8s", lengthKey: "sxl18", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Circuit_TerminalLost_OneShot2D, key: "sxa670", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Contract_SquadWipe_OneShot2D", display: "Gauntlet Contract SquadWipe OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2940, lengthText: "1.9s", lengthKey: "sxl19", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Contract_SquadWipe_OneShot2D, key: "sxa671", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_DataUpload_DataDeposit_OneShot2D", display: "Gauntlet DataUpload DataDeposit OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3990, lengthText: "3.0s", lengthKey: "sxl30", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_DataUpload_DataDeposit_OneShot2D, key: "sxa672", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_DataUpload_DataDepositLoop_SimpleLoop2D", display: "Gauntlet DataUpload DataDepositLoop SimpleLoop2D", category: "UI_Gauntlet", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_DataUpload_DataDepositLoop_SimpleLoop2D, key: "sxa673", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_DataUpload_DataDepositPointDisable_OneShot2D", display: "Gauntlet DataUpload DataDepositPointDisable OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_DataUpload_DataDepositPointDisable_OneShot2D, key: "sxa674", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_DataUpload_DataDepositPointEnable_OneShot2D", display: "Gauntlet DataUpload DataDepositPointEnable OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_DataUpload_DataDepositPointEnable_OneShot2D, key: "sxa675", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_DataUpload_DataDepositStart_OneShot2D", display: "Gauntlet DataUpload DataDepositStart OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_DataUpload_DataDepositStart_OneShot2D, key: "sxa676", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_DataUpload_DataDepositStop_OneShot2D", display: "Gauntlet DataUpload DataDepositStop OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_DataUpload_DataDepositStop_OneShot2D, key: "sxa677", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_DataUpload_DataLost_OneShot2D", display: "Gauntlet DataUpload DataLost OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2650, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_DataUpload_DataLost_OneShot2D, key: "sxa678", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_DataUpload_DataPickup_OneShot2D", display: "Gauntlet DataUpload DataPickup OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_DataUpload_DataPickup_OneShot2D, key: "sxa679", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Dogtags_OneShot2D", display: "Gauntlet Dogtags OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3850, lengthText: "2.9s", lengthKey: "sxl29", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Dogtags_OneShot2D, key: "sxa680", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_AdvanceCardArrive_OneShot2D", display: "Gauntlet EOM AdvanceCardArrive OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_AdvanceCardArrive_OneShot2D, key: "sxa681", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_AdvanceCardReveal_OneShot2D", display: "Gauntlet EOM AdvanceCardReveal OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_AdvanceCardReveal_OneShot2D, key: "sxa682", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_AdvanceScreen_In_OneShot2D", display: "Gauntlet EOM AdvanceScreen In OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2580, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_AdvanceScreen_In_OneShot2D, key: "sxa683", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_CountdownTick_OneShot2D", display: "Gauntlet EOM CountdownTick OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_CountdownTick_OneShot2D, key: "sxa684", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_Defeat_OneShot2D", display: "Gauntlet EOM Defeat OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3770, lengthText: "2.8s", lengthKey: "sxl28", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_Defeat_OneShot2D, key: "sxa685", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_DefeatCardReveal_OneShot2D", display: "Gauntlet EOM DefeatCardReveal OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_DefeatCardReveal_OneShot2D, key: "sxa686", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_DefeatScreen_Arrive_OneShot2D", display: "Gauntlet EOM DefeatScreen Arrive OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 4650, lengthText: "3.7s", lengthKey: "sxl37", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_DefeatScreen_Arrive_OneShot2D, key: "sxa687", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_DefeatScreen_Out_LeadIn_OneShot2D", display: "Gauntlet EOM DefeatScreen Out LeadIn OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3140, lengthText: "2.1s", lengthKey: "sxl21", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_DefeatScreen_Out_LeadIn_OneShot2D, key: "sxa688", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_PlayerSquadCardDetails_OneShot2D", display: "Gauntlet EOM PlayerSquadCardDetails OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2660, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_PlayerSquadCardDetails_OneShot2D, key: "sxa689", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_Qualified_OneShot2D", display: "Gauntlet EOM Qualified OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 6470, lengthText: "5.5s", lengthKey: "sxl55", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_Qualified_OneShot2D, key: "sxa690", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_Qualified_ReceiveReinforcement_OneShot2D", display: "Gauntlet EOM Qualified ReceiveReinforcement OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_Qualified_ReceiveReinforcement_OneShot2D, key: "sxa691", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_Reassigned_OneShot2D", display: "Gauntlet EOM Reassigned OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 4710, lengthText: "3.7s", lengthKey: "sxl37", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_Reassigned_OneShot2D, key: "sxa692", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_ReinforcementCardReveal_OneShot2D", display: "Gauntlet EOM ReinforcementCardReveal OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2900, lengthText: "1.9s", lengthKey: "sxl19", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_ReinforcementCardReveal_OneShot2D, key: "sxa693", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_ReinforcementsGiven_OneShot2D", display: "Gauntlet EOM ReinforcementsGiven OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_ReinforcementsGiven_OneShot2D, key: "sxa694", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_ReinforcementsReceived_OneShot2D", display: "Gauntlet EOM ReinforcementsReceived OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_ReinforcementsReceived_OneShot2D, key: "sxa695", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_EOM_TopAdvanceCardReveal_OneShot2D", display: "Gauntlet EOM TopAdvanceCardReveal OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_EOM_TopAdvanceCardReveal_OneShot2D, key: "sxa696", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Heist_AltCacheStolen_OneShot2D", display: "Gauntlet Heist AltCacheStolen OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2590, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Heist_AltCacheStolen_OneShot2D, key: "sxa697", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Heist_AltEnemyCapturedCache_OneShot2D", display: "Gauntlet Heist AltEnemyCapturedCache OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3900, lengthText: "2.9s", lengthKey: "sxl29", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Heist_AltEnemyCapturedCache_OneShot2D, key: "sxa698", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Heist_AltFriendlyRecoveredCache_OneShot2D", display: "Gauntlet Heist AltFriendlyRecoveredCache OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3500, lengthText: "2.5s", lengthKey: "sxl25", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Heist_AltFriendlyRecoveredCache_OneShot2D, key: "sxa699", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Heist_AltRecoveringCacheStart_OneShot2D", display: "Gauntlet Heist AltRecoveringCacheStart OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Heist_AltRecoveringCacheStart_OneShot2D, key: "sxa700", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Heist_AltRecoveringCacheStop_OneShot2D", display: "Gauntlet Heist AltRecoveringCacheStop OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Heist_AltRecoveringCacheStop_OneShot2D, key: "sxa701", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Heist_AltRecoveringCacheTimer_OneShot2D", display: "Gauntlet Heist AltRecoveringCacheTimer OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 6200, lengthText: "5.2s", lengthKey: "sxl52", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Heist_AltRecoveringCacheTimer_OneShot2D, key: "sxa702", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Heist_EnemyCapturedCache_OneShot2D", display: "Gauntlet Heist EnemyCapturedCache OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3310, lengthText: "2.3s", lengthKey: "sxl23", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Heist_EnemyCapturedCache_OneShot2D, key: "sxa703", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Heist_EnemyPickedUpCache_OneShot2D", display: "Gauntlet Heist EnemyPickedUpCache OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Heist_EnemyPickedUpCache_OneShot2D, key: "sxa704", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Heist_FriendlyCapturedCache_OneShot2D", display: "Gauntlet Heist FriendlyCapturedCache OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2660, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Heist_FriendlyCapturedCache_OneShot2D, key: "sxa705", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Heist_FriendlyPickedUpCache_OneShot2D", display: "Gauntlet Heist FriendlyPickedUpCache OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Heist_FriendlyPickedUpCache_OneShot2D, key: "sxa706", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_MissionBriefing_Base_OneShot2D", display: "Gauntlet MissionBriefing Base OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 5830, lengthText: "4.8s", lengthKey: "sxl48", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_MissionBriefing_Base_OneShot2D, key: "sxa707", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_MissionBriefing_Circuit_OneShot2D", display: "Gauntlet MissionBriefing Circuit OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_MissionBriefing_Circuit_OneShot2D, key: "sxa708", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_MissionBriefing_Contract_OneShot2D", display: "Gauntlet MissionBriefing Contract OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_MissionBriefing_Contract_OneShot2D, key: "sxa709", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_MissionBriefing_Decryption_OneShot2D", display: "Gauntlet MissionBriefing Decryption OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_MissionBriefing_Decryption_OneShot2D, key: "sxa710", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_MissionBriefing_Extraction_OneShot2D", display: "Gauntlet MissionBriefing Extraction OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_MissionBriefing_Extraction_OneShot2D, key: "sxa711", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_MissionBriefing_Heist_OneShot2D", display: "Gauntlet MissionBriefing Heist OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_MissionBriefing_Heist_OneShot2D, key: "sxa712", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_MissionBriefing_Rodeo_OneShot2D", display: "Gauntlet MissionBriefing Rodeo OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_MissionBriefing_Rodeo_OneShot2D, key: "sxa713", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_MissionBriefing_Standoff_OneShot2D", display: "Gauntlet MissionBriefing Standoff OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_MissionBriefing_Standoff_OneShot2D, key: "sxa714", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_MissionBriefing_Vendetta_OneShot2D", display: "Gauntlet MissionBriefing Vendetta OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_MissionBriefing_Vendetta_OneShot2D, key: "sxa715", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_MissionBriefing_Wreckage_OneShot2D", display: "Gauntlet MissionBriefing Wreckage OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_MissionBriefing_Wreckage_OneShot2D, key: "sxa716", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Qualifier_Disqualified_OneShot2D", display: "Gauntlet Qualifier Disqualified OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Qualifier_Disqualified_OneShot2D, key: "sxa717", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Qualifier_PositionGained_OneShot2D", display: "Gauntlet Qualifier PositionGained OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Qualifier_PositionGained_OneShot2D, key: "sxa718", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Qualifier_PositionLost_OneShot2D", display: "Gauntlet Qualifier PositionLost OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Qualifier_PositionLost_OneShot2D, key: "sxa719", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Qualifier_Qualified_OneShot2D", display: "Gauntlet Qualifier Qualified OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Qualifier_Qualified_OneShot2D, key: "sxa720", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Rodeo_TankAcquired_OneShot2D", display: "Gauntlet Rodeo TankAcquired OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 4800, lengthText: "3.8s", lengthKey: "sxl38", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Rodeo_TankAcquired_OneShot2D, key: "sxa721", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Rodeo_TankKillPoint_OneShot2D", display: "Gauntlet Rodeo TankKillPoint OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Rodeo_TankKillPoint_OneShot2D, key: "sxa722", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Rodeo_TanksAvailable_OneShot2D", display: "Gauntlet Rodeo TanksAvailable OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 4200, lengthText: "3.2s", lengthKey: "sxl32", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Rodeo_TanksAvailable_OneShot2D, key: "sxa723", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Rodeo_TanksLockerUnlocking_OneShot2D", display: "Gauntlet Rodeo TanksLockerUnlocking OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3500, lengthText: "2.5s", lengthKey: "sxl25", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Rodeo_TanksLockerUnlocking_OneShot2D, key: "sxa724", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Standoff_ZoneAlmostDepleted_OneShot2D", display: "Gauntlet Standoff ZoneAlmostDepleted OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3120, lengthText: "2.1s", lengthKey: "sxl21", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Standoff_ZoneAlmostDepleted_OneShot2D, key: "sxa725", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Standoff_ZoneCaptured_OneShot2D", display: "Gauntlet Standoff ZoneCaptured OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3460, lengthText: "2.5s", lengthKey: "sxl25", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Standoff_ZoneCaptured_OneShot2D, key: "sxa726", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Standoff_ZoneCaptureTick_OneShot2D", display: "Gauntlet Standoff ZoneCaptureTick OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Standoff_ZoneCaptureTick_OneShot2D, key: "sxa727", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Standoff_ZoneContested_OneShot2D", display: "Gauntlet Standoff ZoneContested OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Standoff_ZoneContested_OneShot2D, key: "sxa728", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Standoff_ZoneEnter_OneShot2D", display: "Gauntlet Standoff ZoneEnter OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Standoff_ZoneEnter_OneShot2D, key: "sxa729", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Standoff_ZoneExit_OneShot2D", display: "Gauntlet Standoff ZoneExit OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Standoff_ZoneExit_OneShot2D, key: "sxa730", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Vendetta_FriendlyHVTKilled_OneShot2D", display: "Gauntlet Vendetta FriendlyHVTKilled OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2850, lengthText: "1.9s", lengthKey: "sxl19", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Vendetta_FriendlyHVTKilled_OneShot2D, key: "sxa731", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Vendetta_IncomingHVTSelection_OneShot2D", display: "Gauntlet Vendetta IncomingHVTSelection OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3500, lengthText: "2.5s", lengthKey: "sxl25", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Vendetta_IncomingHVTSelection_OneShot2D, key: "sxa732", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Vendetta_NewHVT_OneShot2D", display: "Gauntlet Vendetta NewHVT OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 4410, lengthText: "3.4s", lengthKey: "sxl34", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Vendetta_NewHVT_OneShot2D, key: "sxa733", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Vendetta_PlayerKilledHVT_OneShot2D", display: "Gauntlet Vendetta PlayerKilledHVT OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Vendetta_PlayerKilledHVT_OneShot2D, key: "sxa734", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Vendetta_YouAreTheTarget_OneShot2D", display: "Gauntlet Vendetta YouAreTheTarget OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 4270, lengthText: "3.3s", lengthKey: "sxl33", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Vendetta_YouAreTheTarget_OneShot2D, key: "sxa735", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Wreckage_BombBeeping_OneShot2D", display: "Gauntlet Wreckage BombBeeping OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Wreckage_BombBeeping_OneShot2D, key: "sxa736", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Wreckage_BombCarrier_OneShot2D", display: "Gauntlet Wreckage BombCarrier OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Wreckage_BombCarrier_OneShot2D, key: "sxa737", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Wreckage_BombKilledSelf_OneShot2D", display: "Gauntlet Wreckage BombKilledSelf OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 4060, lengthText: "3.1s", lengthKey: "sxl31", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Wreckage_BombKilledSelf_OneShot2D, key: "sxa738", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Wreckage_BombPickup_OneShot2D", display: "Gauntlet Wreckage BombPickup OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Wreckage_BombPickup_OneShot2D, key: "sxa739", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Wreckage_BombPlanted_OneShot2D", display: "Gauntlet Wreckage BombPlanted OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2660, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Wreckage_BombPlanted_OneShot2D, key: "sxa740", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Wreckage_BombPlantLoop_SimpleLoop2D", display: "Gauntlet Wreckage BombPlantLoop SimpleLoop2D", category: "UI_Gauntlet", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Wreckage_BombPlantLoop_SimpleLoop2D, key: "sxa741", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Wreckage_BombPlantStart_OneShot2D", display: "Gauntlet Wreckage BombPlantStart OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Wreckage_BombPlantStart_OneShot2D, key: "sxa742", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Wreckage_BombPlantStop_OneShot2D", display: "Gauntlet Wreckage BombPlantStop OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Wreckage_BombPlantStop_OneShot2D, key: "sxa743", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Wreckage_BompDropped_OneShot2D", display: "Gauntlet Wreckage BompDropped OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3110, lengthText: "2.1s", lengthKey: "sxl21", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Wreckage_BompDropped_OneShot2D, key: "sxa744", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Wreckage_EnemyCarrierKilled_OneShot2D", display: "Gauntlet Wreckage EnemyCarrierKilled OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2690, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Wreckage_EnemyCarrierKilled_OneShot2D, key: "sxa745", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Wreckage_FriendlyBombPlanted_OneShot2D", display: "Gauntlet Wreckage FriendlyBombPlanted OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2660, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Wreckage_FriendlyBombPlanted_OneShot2D, key: "sxa746", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Wreckage_FuseLow_OneShot2D", display: "Gauntlet Wreckage FuseLow OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 2930, lengthText: "1.9s", lengthKey: "sxl19", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Wreckage_FuseLow_OneShot2D, key: "sxa747", catKey: "sxg46" },
{ name: "SFX_UI_Gauntlet_Wreckage_MCOMDestroyed_OneShot2D", display: "Gauntlet Wreckage MCOMDestroyed OneShot2D", category: "UI_Gauntlet", kind: "oneshot", dim: "2d", windowMs: 3190, lengthText: "2.2s", lengthKey: "sxl22", asset: mod.RuntimeSpawn_Common.SFX_UI_Gauntlet_Wreckage_MCOMDestroyed_OneShot2D, key: "sxa748", catKey: "sxg46" },
{ name: "SFX_UI_Highlight_A_2D", display: "Highlight A 2D", category: "UI_Highlight", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Highlight_A_2D, key: "sxa749", catKey: "sxg47" },
{ name: "SFX_UI_Highlight_B_2D", display: "Highlight B 2D", category: "UI_Highlight", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_Highlight_B_2D, key: "sxa750", catKey: "sxg47" },
{ name: "SFX_UI_MainMenu_PressPlay_OneShot2D", display: "MainMenu PressPlay OneShot2D", category: "UI_MainMenu", kind: "oneshot", dim: "2d", windowMs: 4170, lengthText: "3.2s", lengthKey: "sxl32", asset: mod.RuntimeSpawn_Common.SFX_UI_MainMenu_PressPlay_OneShot2D, key: "sxa751", catKey: "sxg48" },
{ name: "SFX_UI_Map_Close_OneShot2D", display: "Map Close OneShot2D", category: "UI_Map", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_Map_Close_OneShot2D, key: "sxa752", catKey: "sxg49" },
{ name: "SFX_UI_Map_MapMovement_IsZooming_SimpleLoop2D", display: "Map MapMovement IsZooming SimpleLoop2D", category: "UI_Map", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_UI_Map_MapMovement_IsZooming_SimpleLoop2D, key: "sxa753", catKey: "sxg49" },
{ name: "SFX_UI_Map_MapMovement_PanSpeed_SimpleLoop2D", display: "Map MapMovement PanSpeed SimpleLoop2D", category: "UI_Map", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_UI_Map_MapMovement_PanSpeed_SimpleLoop2D, key: "sxa754", catKey: "sxg49" },
{ name: "SFX_UI_Map_MapMovement_PanStart_OneShot2D", display: "Map MapMovement PanStart OneShot2D", category: "UI_Map", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_Map_MapMovement_PanStart_OneShot2D, key: "sxa755", catKey: "sxg49" },
{ name: "SFX_UI_Map_MapMovement_PanStop_OneShot2D", display: "Map MapMovement PanStop OneShot2D", category: "UI_Map", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_Map_MapMovement_PanStop_OneShot2D, key: "sxa756", catKey: "sxg49" },
{ name: "SFX_UI_Map_MapMovement_ResetZoom_OneShot2D", display: "Map MapMovement ResetZoom OneShot2D", category: "UI_Map", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Map_MapMovement_ResetZoom_OneShot2D, key: "sxa757", catKey: "sxg49" },
{ name: "SFX_UI_Map_MapMovement_ZoomBlocked_OneShot2D", display: "Map MapMovement ZoomBlocked OneShot2D", category: "UI_Map", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_Map_MapMovement_ZoomBlocked_OneShot2D, key: "sxa758", catKey: "sxg49" },
{ name: "SFX_UI_Map_MapMovement_ZoomIn_OneShot2D", display: "Map MapMovement ZoomIn OneShot2D", category: "UI_Map", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_Map_MapMovement_ZoomIn_OneShot2D, key: "sxa759", catKey: "sxg49" },
{ name: "SFX_UI_Map_MapMovement_ZoomOut_OneShot2D", display: "Map MapMovement ZoomOut OneShot2D", category: "UI_Map", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_Map_MapMovement_ZoomOut_OneShot2D, key: "sxa760", catKey: "sxg49" },
{ name: "SFX_UI_Map_Open_OneShot2D", display: "Map Open OneShot2D", category: "UI_Map", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_Map_Open_OneShot2D, key: "sxa761", catKey: "sxg49" },
{ name: "SFX_UI_Matchmaking_FoundMatch_OneShot2D", display: "Matchmaking FoundMatch OneShot2D", category: "UI_Matchmaking", kind: "oneshot", dim: "2d", windowMs: 6380, lengthText: "5.4s", lengthKey: "sxl54", asset: mod.RuntimeSpawn_Common.SFX_UI_Matchmaking_FoundMatch_OneShot2D, key: "sxa762", catKey: "sxg50" },
{ name: "SFX_UI_Matchmaking_Start_OneShot2D", display: "Matchmaking Start OneShot2D", category: "UI_Matchmaking", kind: "oneshot", dim: "2d", windowMs: 3840, lengthText: "2.8s", lengthKey: "sxl28", asset: mod.RuntimeSpawn_Common.SFX_UI_Matchmaking_Start_OneShot2D, key: "sxa763", catKey: "sxg50" },
{ name: "SFX_UI_MenuNavigatin_Profile_Playercard_Background_OneShot2D", display: "MenuNavigatin Profile Playercard Background OneShot2D", category: "UI_MenuNavigatin", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigatin_Profile_Playercard_Background_OneShot2D, key: "sxa764", catKey: "sxg51" },
{ name: "SFX_UI_MenuNavigatin_Profile_Playercard_Badge_OneShot2D", display: "MenuNavigatin Profile Playercard Badge OneShot2D", category: "UI_MenuNavigatin", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigatin_Profile_Playercard_Badge_OneShot2D, key: "sxa765", catKey: "sxg51" },
{ name: "SFX_UI_MenuNavigatin_Profile_Playercard_DogTag_OneShot2D", display: "MenuNavigatin Profile Playercard DogTag OneShot2D", category: "UI_MenuNavigatin", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigatin_Profile_Playercard_DogTag_OneShot2D, key: "sxa766", catKey: "sxg51" },
{ name: "SFX_UI_MenuNavigatin_Profile_Playercard_Equip_OneShot2D", display: "MenuNavigatin Profile Playercard Equip OneShot2D", category: "UI_MenuNavigatin", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigatin_Profile_Playercard_Equip_OneShot2D, key: "sxa767", catKey: "sxg51" },
{ name: "SFX_UI_MenuNavigatin_Profile_Playercard_Focus_OneShot2D", display: "MenuNavigatin Profile Playercard Focus OneShot2D", category: "UI_MenuNavigatin", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigatin_Profile_Playercard_Focus_OneShot2D, key: "sxa768", catKey: "sxg51" },
{ name: "SFX_UI_MenuNavigatin_Profile_Playercard_Loading_OneShot2D", display: "MenuNavigatin Profile Playercard Loading OneShot2D", category: "UI_MenuNavigatin", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigatin_Profile_Playercard_Loading_OneShot2D, key: "sxa769", catKey: "sxg51" },
{ name: "SFX_UI_MenuNavigatin_Profile_Playercard_Pin_OneShot2D", display: "MenuNavigatin Profile Playercard Pin OneShot2D", category: "UI_MenuNavigatin", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigatin_Profile_Playercard_Pin_OneShot2D, key: "sxa770", catKey: "sxg51" },
{ name: "SFX_UI_MenuNavigatin_Profile_Playercard_Remove_Button_OneShot2D", display: "MenuNavigatin Profile Playercard Remove Button OneShot2D", category: "UI_MenuNavigatin", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigatin_Profile_Playercard_Remove_Button_OneShot2D, key: "sxa771", catKey: "sxg51" },
{ name: "SFX_UI_MenuNavigatin_Profile_Playercard_Remove_OneShot2D", display: "MenuNavigatin Profile Playercard Remove OneShot2D", category: "UI_MenuNavigatin", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigatin_Profile_Playercard_Remove_OneShot2D, key: "sxa772", catKey: "sxg51" },
{ name: "SFX_UI_MenuNavigatin_Profile_Playercard_Tag_OneShot2D", display: "MenuNavigatin Profile Playercard Tag OneShot2D", category: "UI_MenuNavigatin", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigatin_Profile_Playercard_Tag_OneShot2D, key: "sxa773", catKey: "sxg51" },
{ name: "SFX_UI_MenuNavigatin_Profile_Playercard_Title_OneShot2D", display: "MenuNavigatin Profile Playercard Title OneShot2D", category: "UI_MenuNavigatin", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigatin_Profile_Playercard_Title_OneShot2D, key: "sxa774", catKey: "sxg51" },
{ name: "SFX_UI_MenuNavigation_Challenges_DateMenuSelect_OneShot2D", display: "MenuNavigation Challenges DateMenuSelect OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Challenges_DateMenuSelect_OneShot2D, key: "sxa775", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Challenges_HoverChallenge_OneShot2D", display: "MenuNavigation Challenges HoverChallenge OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Challenges_HoverChallenge_OneShot2D, key: "sxa776", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Challenges_HoverChallengeCategory_OneShot2D", display: "MenuNavigation Challenges HoverChallengeCategory OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Challenges_HoverChallengeCategory_OneShot2D, key: "sxa777", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Challenges_MultiTierChallengeSelections_OneShot2D", display: "MenuNavigation Challenges MultiTierChallengeSelections OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Challenges_MultiTierChallengeSelections_OneShot2D, key: "sxa778", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Challenges_RerollConfirm_OneShot2D", display: "MenuNavigation Challenges RerollConfirm OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Challenges_RerollConfirm_OneShot2D, key: "sxa779", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Challenges_RerollMenu_OneShot2D", display: "MenuNavigation Challenges RerollMenu OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Challenges_RerollMenu_OneShot2D, key: "sxa780", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Challenges_RerollMenuCancel_OneShot2D", display: "MenuNavigation Challenges RerollMenuCancel OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Challenges_RerollMenuCancel_OneShot2D, key: "sxa781", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Challenges_ScreenArrive_OneShot2D", display: "MenuNavigation Challenges ScreenArrive OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Challenges_ScreenArrive_OneShot2D, key: "sxa782", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Challenges_SelectChallenge_OneShot2D", display: "MenuNavigation Challenges SelectChallenge OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Challenges_SelectChallenge_OneShot2D, key: "sxa783", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Challenges_SelectChallengeCategory_OneShot2D", display: "MenuNavigation Challenges SelectChallengeCategory OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Challenges_SelectChallengeCategory_OneShot2D, key: "sxa784", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Challenges_Track_OneShot2D", display: "MenuNavigation Challenges Track OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Challenges_Track_OneShot2D, key: "sxa785", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Challenges_Untrack_OneShot2D", display: "MenuNavigation Challenges Untrack OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Challenges_Untrack_OneShot2D, key: "sxa786", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Default_EnumSelection_OneShot2D", display: "MenuNavigation Default EnumSelection OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_EnumSelection_OneShot2D, key: "sxa787", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Default_Focus_OneShot2D", display: "MenuNavigation Default Focus OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_Focus_OneShot2D, key: "sxa788", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Default_GoBack_OneShot2D", display: "MenuNavigation Default GoBack OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_GoBack_OneShot2D, key: "sxa789", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Default_Highlight_OneShot2D", display: "MenuNavigation Default Highlight OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_Highlight_OneShot2D, key: "sxa790", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Default_HoverIn_OneShot2D", display: "MenuNavigation Default HoverIn OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_HoverIn_OneShot2D, key: "sxa791", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Default_PrimaryActivation_OneShot2D", display: "MenuNavigation Default PrimaryActivation OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_PrimaryActivation_OneShot2D, key: "sxa792", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Default_PrimarySelect_OneShot2D", display: "MenuNavigation Default PrimarySelect OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_PrimarySelect_OneShot2D, key: "sxa793", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Default_SecondaryActivation_OneShot2D", display: "MenuNavigation Default SecondaryActivation OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_SecondaryActivation_OneShot2D, key: "sxa794", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Default_SecondarySelect_OneShot2D", display: "MenuNavigation Default SecondarySelect OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_SecondarySelect_OneShot2D, key: "sxa795", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Default_SlidersClickDown_OneShot2D", display: "MenuNavigation Default SlidersClickDown OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.3s", lengthKey: "sxl3", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_SlidersClickDown_OneShot2D, key: "sxa796", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Default_ToggleOff_OneShot2D", display: "MenuNavigation Default ToggleOff OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_ToggleOff_OneShot2D, key: "sxa797", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Default_ToggleOn_OneShot2D", display: "MenuNavigation Default ToggleOn OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Default_ToggleOn_OneShot2D, key: "sxa798", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Equip_AddLayer_OneShot2D", display: "MenuNavigation Equip AddLayer OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Equip_AddLayer_OneShot2D, key: "sxa799", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Haptics_ResetpackageLoading_OneShot2D", display: "MenuNavigation Haptics ResetpackageLoading OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 5240, lengthText: "4.2s", lengthKey: "sxl42", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Haptics_ResetpackageLoading_OneShot2D, key: "sxa800", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Haptics_Shared_Select_OneShot2D", display: "MenuNavigation Haptics Shared Select OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Haptics_Shared_Select_OneShot2D, key: "sxa801", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Home_ActivateXPBooster_OneShot2D", display: "MenuNavigation Home ActivateXPBooster OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Home_ActivateXPBooster_OneShot2D, key: "sxa802", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Home_ExitPartyMenu_OneShot2D", display: "MenuNavigation Home ExitPartyMenu OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Home_ExitPartyMenu_OneShot2D, key: "sxa803", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Home_OpenPartyMenu_OneShot2D", display: "MenuNavigation Home OpenPartyMenu OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Home_OpenPartyMenu_OneShot2D, key: "sxa804", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Home_OpenXPBoosterWindow_OneShot2D", display: "MenuNavigation Home OpenXPBoosterWindow OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Home_OpenXPBoosterWindow_OneShot2D, key: "sxa805", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Home_PlayCategoryActivation_OneShot2D", display: "MenuNavigation Home PlayCategoryActivation OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Home_PlayCategoryActivation_OneShot2D, key: "sxa806", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Home_PlayerTabActivation_OneShot2D", display: "MenuNavigation Home PlayerTabActivation OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Home_PlayerTabActivation_OneShot2D, key: "sxa807", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Home_PlayItemHover_OneShot2D", display: "MenuNavigation Home PlayItemHover OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Home_PlayItemHover_OneShot2D, key: "sxa808", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Home_PlayItemScroll_OneShot2D", display: "MenuNavigation Home PlayItemScroll OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Home_PlayItemScroll_OneShot2D, key: "sxa809", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Home_ScreenArrive_OneShot2D", display: "MenuNavigation Home ScreenArrive OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Home_ScreenArrive_OneShot2D, key: "sxa810", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Home_SelectPlayCategory_OneShot2D", display: "MenuNavigation Home SelectPlayCategory OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Home_SelectPlayCategory_OneShot2D, key: "sxa811", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Home_SquadfillPrivate_OneShot2D", display: "MenuNavigation Home SquadfillPrivate OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Home_SquadfillPrivate_OneShot2D, key: "sxa812", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Home_SquadfillPublic_OneShot2D", display: "MenuNavigation Home SquadfillPublic OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Home_SquadfillPublic_OneShot2D, key: "sxa813", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Home_StartGame_OneShot2D", display: "MenuNavigation Home StartGame OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 3190, lengthText: "2.2s", lengthKey: "sxl22", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Home_StartGame_OneShot2D, key: "sxa814", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_ClickSelectLoadout_OneShot2D", display: "MenuNavigation Loadout ClickSelectLoadout OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_ClickSelectLoadout_OneShot2D, key: "sxa815", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_CollapseWeaponStats_OneShot2D", display: "MenuNavigation Loadout CollapseWeaponStats OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_CollapseWeaponStats_OneShot2D, key: "sxa816", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_EquipCharacterSkin_OneShot2D", display: "MenuNavigation Loadout EquipCharacterSkin OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_EquipCharacterSkin_OneShot2D, key: "sxa817", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_EquipFieldSpecCloth_OneShot2D", display: "MenuNavigation Loadout EquipFieldSpecCloth OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2660, lengthText: "1.7s", lengthKey: "sxl17", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_EquipFieldSpecCloth_OneShot2D, key: "sxa818", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_EquipFieldSpecfull_OneShot2D", display: "MenuNavigation Loadout EquipFieldSpecfull OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 3230, lengthText: "2.2s", lengthKey: "sxl22", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_EquipFieldSpecfull_OneShot2D, key: "sxa819", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_EquipFieldSpecUIHit_OneShot2D", display: "MenuNavigation Loadout EquipFieldSpecUIHit OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 3230, lengthText: "2.2s", lengthKey: "sxl22", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_EquipFieldSpecUIHit_OneShot2D, key: "sxa820", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_EquipGadget_OneShot2D", display: "MenuNavigation Loadout EquipGadget OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_EquipGadget_OneShot2D, key: "sxa821", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_EquipKnifeMeleeKnife_OneShot2D", display: "MenuNavigation Loadout EquipKnifeMeleeKnife OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_EquipKnifeMeleeKnife_OneShot2D, key: "sxa822", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_EquipKnifeMeleeSledgehammer_OneShot2D", display: "MenuNavigation Loadout EquipKnifeMeleeSledgehammer OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_EquipKnifeMeleeSledgehammer_OneShot2D, key: "sxa823", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_EquippedClassProficiency_OneShot2D", display: "MenuNavigation Loadout EquippedClassProficiency OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2900, lengthText: "1.9s", lengthKey: "sxl19", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_EquippedClassProficiency_OneShot2D, key: "sxa824", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_EquipPrimaryWeapon_OneShot2D", display: "MenuNavigation Loadout EquipPrimaryWeapon OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_EquipPrimaryWeapon_OneShot2D, key: "sxa825", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_EquipSecondaryWeapon_OneShot2D", display: "MenuNavigation Loadout EquipSecondaryWeapon OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_EquipSecondaryWeapon_OneShot2D, key: "sxa826", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_EquipThrowableGranade_OneShot2D", display: "MenuNavigation Loadout EquipThrowableGranade OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_EquipThrowableGranade_OneShot2D, key: "sxa827", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_EquipThrowableKnife_OneShot2D", display: "MenuNavigation Loadout EquipThrowableKnife OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_EquipThrowableKnife_OneShot2D, key: "sxa828", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_ExpandWeaponStats_OneShot2D", display: "MenuNavigation Loadout ExpandWeaponStats OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_ExpandWeaponStats_OneShot2D, key: "sxa829", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_Inspectactivation_OneShot2D", display: "MenuNavigation Loadout Inspectactivation OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_Inspectactivation_OneShot2D, key: "sxa830", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_ModifyWeapon_OneShot2D", display: "MenuNavigation Loadout ModifyWeapon OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_ModifyWeapon_OneShot2D, key: "sxa831", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_ResetPackage_OneShot2D", display: "MenuNavigation Loadout ResetPackage OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 5000, lengthText: "4.0s", lengthKey: "sxl40", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_ResetPackage_OneShot2D, key: "sxa832", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_ResetPackageEnd_OneShot2D", display: "MenuNavigation Loadout ResetPackageEnd OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_ResetPackageEnd_OneShot2D, key: "sxa833", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_ResetpackageLoading_OneShot2D", display: "MenuNavigation Loadout ResetpackageLoading OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 5240, lengthText: "4.2s", lengthKey: "sxl42", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_ResetpackageLoading_OneShot2D, key: "sxa834", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_ResetPackageStart_OneShot2D", display: "MenuNavigation Loadout ResetPackageStart OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_ResetPackageStart_OneShot2D, key: "sxa835", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_ScreenArrive_OneShot2D", display: "MenuNavigation Loadout ScreenArrive OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_ScreenArrive_OneShot2D, key: "sxa836", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_SelectCharacterSkin_OneShot2D", display: "MenuNavigation Loadout SelectCharacterSkin OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_SelectCharacterSkin_OneShot2D, key: "sxa837", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_Swapfaction_OneShot2D", display: "MenuNavigation Loadout Swapfaction OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_Swapfaction_OneShot2D, key: "sxa838", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Loadout_Testweaponactivation_OneShot2D", display: "MenuNavigation Loadout Testweaponactivation OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 3450, lengthText: "2.5s", lengthKey: "sxl25", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Loadout_Testweaponactivation_OneShot2D, key: "sxa839", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Notification_ToasterPopUp_OneShot2D", display: "MenuNavigation Notification ToasterPopUp OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Notification_ToasterPopUp_OneShot2D, key: "sxa840", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_Options_ScreenArrive_OneShot2D", display: "MenuNavigation Options ScreenArrive OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_Options_ScreenArrive_OneShot2D, key: "sxa841", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_EquipGunnerEquipment_OneShot2D", display: "MenuNavigation VehicleLoadout EquipGunnerEquipment OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2550, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_EquipGunnerEquipment_OneShot2D, key: "sxa842", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_EquipGunnerWeapon_OneShot2D", display: "MenuNavigation VehicleLoadout EquipGunnerWeapon OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2590, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_EquipGunnerWeapon_OneShot2D, key: "sxa843", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_EquipVehicleDecal_OneShot2D", display: "MenuNavigation VehicleLoadout EquipVehicleDecal OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_EquipVehicleDecal_OneShot2D, key: "sxa844", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_EquipVehicleEquipment_OneShot2D", display: "MenuNavigation VehicleLoadout EquipVehicleEquipment OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_EquipVehicleEquipment_OneShot2D, key: "sxa845", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_EquipVehiclePassive_OneShot2D", display: "MenuNavigation VehicleLoadout EquipVehiclePassive OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2770, lengthText: "1.8s", lengthKey: "sxl18", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_EquipVehiclePassive_OneShot2D, key: "sxa846", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_EquipVehicleSkin_OneShot2D", display: "MenuNavigation VehicleLoadout EquipVehicleSkin OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2510, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_EquipVehicleSkin_OneShot2D, key: "sxa847", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_EquipVehicleWeapon_OneShot2D", display: "MenuNavigation VehicleLoadout EquipVehicleWeapon OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_EquipVehicleWeapon_OneShot2D, key: "sxa848", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectGunnerEquipment_OneShot2D", display: "MenuNavigation VehicleLoadout SelectGunnerEquipment OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectGunnerEquipment_OneShot2D, key: "sxa849", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectGunnerWeapon_OneShot2D", display: "MenuNavigation VehicleLoadout SelectGunnerWeapon OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectGunnerWeapon_OneShot2D, key: "sxa850", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleAA_OneShot2D", display: "MenuNavigation VehicleLoadout SelectVehicleAA OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 3340, lengthText: "2.3s", lengthKey: "sxl23", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleAA_OneShot2D, key: "sxa851", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleArmoredCarrier_OneShot2D", display: "MenuNavigation VehicleLoadout SelectVehicleArmoredCarrier OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 3360, lengthText: "2.4s", lengthKey: "sxl24", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleArmoredCarrier_OneShot2D, key: "sxa852", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleAttackPlane_OneShot2D", display: "MenuNavigation VehicleLoadout SelectVehicleAttackPlane OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 3380, lengthText: "2.4s", lengthKey: "sxl24", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleAttackPlane_OneShot2D, key: "sxa853", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleDecal_OneShot2D", display: "MenuNavigation VehicleLoadout SelectVehicleDecal OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleDecal_OneShot2D, key: "sxa854", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleEquipment_OneShot2D", display: "MenuNavigation VehicleLoadout SelectVehicleEquipment OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleEquipment_OneShot2D, key: "sxa855", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleFighterPlane_OneShot2D", display: "MenuNavigation VehicleLoadout SelectVehicleFighterPlane OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 3250, lengthText: "2.3s", lengthKey: "sxl23", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleFighterPlane_OneShot2D, key: "sxa856", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleHelicopter_OneShot2D", display: "MenuNavigation VehicleLoadout SelectVehicleHelicopter OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 3440, lengthText: "2.4s", lengthKey: "sxl24", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleHelicopter_OneShot2D, key: "sxa857", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleIFV_OneShot2D", display: "MenuNavigation VehicleLoadout SelectVehicleIFV OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 3440, lengthText: "2.4s", lengthKey: "sxl24", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleIFV_OneShot2D, key: "sxa858", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectVehiclePassive_OneShot2D", display: "MenuNavigation VehicleLoadout SelectVehiclePassive OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectVehiclePassive_OneShot2D, key: "sxa859", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleSkin_OneShot2D", display: "MenuNavigation VehicleLoadout SelectVehicleSkin OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleSkin_OneShot2D, key: "sxa860", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleTank_OneShot2D", display: "MenuNavigation VehicleLoadout SelectVehicleTank OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 3730, lengthText: "2.7s", lengthKey: "sxl27", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleTank_OneShot2D, key: "sxa861", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleWeapon_OneShot2D", display: "MenuNavigation VehicleLoadout SelectVehicleWeapon OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_SelectVehicleWeapon_OneShot2D, key: "sxa862", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_VehicleLoadout_VehiclePresetActivation_OneShot2D", display: "MenuNavigation VehicleLoadout VehiclePresetActivation OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2580, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_VehicleLoadout_VehiclePresetActivation_OneShot2D, key: "sxa863", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_WeaponAttachment_AlreadyEquipped_OneShot2D", display: "MenuNavigation WeaponAttachment AlreadyEquipped OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_WeaponAttachment_AlreadyEquipped_OneShot2D, key: "sxa864", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_WeaponAttachment_AttachmentSlot_OneShot2D", display: "MenuNavigation WeaponAttachment AttachmentSlot OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_WeaponAttachment_AttachmentSlot_OneShot2D, key: "sxa865", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_WeaponAttachment_EquipAttachment_OneShot2D", display: "MenuNavigation WeaponAttachment EquipAttachment OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_WeaponAttachment_EquipAttachment_OneShot2D, key: "sxa866", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_WeaponAttachment_Focus_OneShot2D", display: "MenuNavigation WeaponAttachment Focus OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_WeaponAttachment_Focus_OneShot2D, key: "sxa867", catKey: "sxg52" },
{ name: "SFX_UI_MenuNavigation_WeaponAttachment_NoPoints_OneShot2D", display: "MenuNavigation WeaponAttachment NoPoints OneShot2D", category: "UI_MenuNavigation", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_MenuNavigation_WeaponAttachment_NoPoints_OneShot2D, key: "sxa868", catKey: "sxg52" },
{ name: "SFX_UI_Notification_FieldUpgrade_Main_OneShot2D", display: "Notification FieldUpgrade Main OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 4100, lengthText: "3.1s", lengthKey: "sxl31", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_FieldUpgrade_Main_OneShot2D, key: "sxa869", catKey: "sxg53" },
{ name: "SFX_UI_Notification_FieldUpgrade_OnTrait_OneShot2D", display: "Notification FieldUpgrade OnTrait OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_FieldUpgrade_OnTrait_OneShot2D, key: "sxa870", catKey: "sxg53" },
{ name: "SFX_UI_Notification_FieldUpgrade_RankFinal_OneShot2D", display: "Notification FieldUpgrade RankFinal OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 5140, lengthText: "4.1s", lengthKey: "sxl41", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_FieldUpgrade_RankFinal_OneShot2D, key: "sxa871", catKey: "sxg53" },
{ name: "SFX_UI_Notification_FieldUpgrade_RankOne_OneShot2D", display: "Notification FieldUpgrade RankOne OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 5100, lengthText: "4.1s", lengthKey: "sxl41", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_FieldUpgrade_RankOne_OneShot2D, key: "sxa872", catKey: "sxg53" },
{ name: "SFX_UI_Notification_FieldUpgrade_RankTwo_OneShot2D", display: "Notification FieldUpgrade RankTwo OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 4210, lengthText: "3.2s", lengthKey: "sxl32", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_FieldUpgrade_RankTwo_OneShot2D, key: "sxa873", catKey: "sxg53" },
{ name: "SFX_UI_Notification_FieldUpgrade_RankUnlock_OneShot2D", display: "Notification FieldUpgrade RankUnlock OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_FieldUpgrade_RankUnlock_OneShot2D, key: "sxa874", catKey: "sxg53" },
{ name: "SFX_UI_Notification_ObjectiveSecured_FadeIn_OneShot2D", display: "Notification ObjectiveSecured FadeIn OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_ObjectiveSecured_FadeIn_OneShot2D, key: "sxa875", catKey: "sxg53" },
{ name: "SFX_UI_Notification_ObjectiveSecured_FillIn_Negative_OneShot2D", display: "Notification ObjectiveSecured FillIn Negative OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_ObjectiveSecured_FillIn_Negative_OneShot2D, key: "sxa876", catKey: "sxg53" },
{ name: "SFX_UI_Notification_ObjectiveSecured_FillIn_Neutral_OneShot2D", display: "Notification ObjectiveSecured FillIn Neutral OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_ObjectiveSecured_FillIn_Neutral_OneShot2D, key: "sxa877", catKey: "sxg53" },
{ name: "SFX_UI_Notification_ObjectiveSecured_FillIn_Positive_OneShot2D", display: "Notification ObjectiveSecured FillIn Positive OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_ObjectiveSecured_FillIn_Positive_OneShot2D, key: "sxa878", catKey: "sxg53" },
{ name: "SFX_UI_Notification_Primary_A_2D", display: "Notification Primary A 2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 3140, lengthText: "2.1s", lengthKey: "sxl21", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_Primary_A_2D, key: "sxa879", catKey: "sxg53" },
{ name: "SFX_UI_Notification_Primary_B_2D", display: "Notification Primary B 2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 3670, lengthText: "2.7s", lengthKey: "sxl27", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_Primary_B_2D, key: "sxa880", catKey: "sxg53" },
{ name: "SFX_UI_Notification_Primary_C_2D", display: "Notification Primary C 2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 3910, lengthText: "2.9s", lengthKey: "sxl29", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_Primary_C_2D, key: "sxa881", catKey: "sxg53" },
{ name: "SFX_UI_Notification_Primary_D_2D", display: "Notification Primary D 2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 4790, lengthText: "3.8s", lengthKey: "sxl38", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_Primary_D_2D, key: "sxa882", catKey: "sxg53" },
{ name: "SFX_UI_Notification_Primary_E_2D", display: "Notification Primary E 2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 9480, lengthText: "8.5s", lengthKey: "sxl85", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_Primary_E_2D, key: "sxa883", catKey: "sxg53" },
{ name: "SFX_UI_Notification_Primary_F_2D", display: "Notification Primary F 2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 4330, lengthText: "3.3s", lengthKey: "sxl33", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_Primary_F_2D, key: "sxa884", catKey: "sxg53" },
{ name: "SFX_UI_Notification_Primary_G_2D", display: "Notification Primary G 2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 6670, lengthText: "5.7s", lengthKey: "sxl57", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_Primary_G_2D, key: "sxa885", catKey: "sxg53" },
{ name: "SFX_UI_Notification_Primary_H_2D", display: "Notification Primary H 2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 3400, lengthText: "2.4s", lengthKey: "sxl24", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_Primary_H_2D, key: "sxa886", catKey: "sxg53" },
{ name: "SFX_UI_Notification_Primary_I_2D", display: "Notification Primary I 2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 3120, lengthText: "2.1s", lengthKey: "sxl21", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_Primary_I_2D, key: "sxa887", catKey: "sxg53" },
{ name: "SFX_UI_Notification_Primary_J_2D", display: "Notification Primary J 2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 4720, lengthText: "3.7s", lengthKey: "sxl37", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_Primary_J_2D, key: "sxa888", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SectorBonus_NumberChange_OneShot2D", display: "Notification SectorBonus NumberChange OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SectorBonus_NumberChange_OneShot2D, key: "sxa889", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SectorBonus_ProgressBarFillingUp_OneShot2D", display: "Notification SectorBonus ProgressBarFillingUp OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 4410, lengthText: "3.4s", lengthKey: "sxl34", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SectorBonus_ProgressBarFillingUp_OneShot2D, key: "sxa890", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SectorBonus_ProgressBarFinished_OneShot2D", display: "Notification SectorBonus ProgressBarFinished OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 3460, lengthText: "2.5s", lengthKey: "sxl25", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SectorBonus_ProgressBarFinished_OneShot2D, key: "sxa891", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SectorNext_FadeIn_OneShot2D", display: "Notification SectorNext FadeIn OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SectorNext_FadeIn_OneShot2D, key: "sxa892", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SectorNext_FlyOut_OneShot2D", display: "Notification SectorNext FlyOut OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SectorNext_FlyOut_OneShot2D, key: "sxa893", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SectorPerformance_Start_OneShot2D", display: "Notification SectorPerformance Start OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 4200, lengthText: "3.2s", lengthKey: "sxl32", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SectorPerformance_Start_OneShot2D, key: "sxa894", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SectorTaken_Counter_Negative_OneShot2D", display: "Notification SectorTaken Counter Negative OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SectorTaken_Counter_Negative_OneShot2D, key: "sxa895", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SectorTaken_Counter_Positive_OneShot2D", display: "Notification SectorTaken Counter Positive OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SectorTaken_Counter_Positive_OneShot2D, key: "sxa896", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SectorTaken_Reveal_OneShot2D", display: "Notification SectorTaken Reveal OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SectorTaken_Reveal_OneShot2D, key: "sxa897", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SharedGamemode_GameModeArrows_OneShot2D", display: "Notification SharedGamemode GameModeArrows OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SharedGamemode_GameModeArrows_OneShot2D, key: "sxa898", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SharedGamemode_GameModeArrowsFirst_OneShot2D", display: "Notification SharedGamemode GameModeArrowsFirst OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SharedGamemode_GameModeArrowsFirst_OneShot2D, key: "sxa899", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SharedGamemode_GameModeArrowsSubsequent_OneShot2D", display: "Notification SharedGamemode GameModeArrowsSubsequent OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SharedGamemode_GameModeArrowsSubsequent_OneShot2D, key: "sxa900", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SharedGamemode_GameModeCritical_OneShot2D", display: "Notification SharedGamemode GameModeCritical OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 3850, lengthText: "2.9s", lengthKey: "sxl29", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SharedGamemode_GameModeCritical_OneShot2D, key: "sxa901", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SidePanel_CenterSwipeOut_OneShot2D", display: "Notification SidePanel CenterSwipeOut OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SidePanel_CenterSwipeOut_OneShot2D, key: "sxa902", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SidePanel_ChallengeComplete_OneShot2D", display: "Notification SidePanel ChallengeComplete OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2800, lengthText: "1.8s", lengthKey: "sxl18", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SidePanel_ChallengeComplete_OneShot2D, key: "sxa903", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SidePanel_ChallengeCriteriaComplete_OneShot2D", display: "Notification SidePanel ChallengeCriteriaComplete OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SidePanel_ChallengeCriteriaComplete_OneShot2D, key: "sxa904", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SidePanel_ChallengeCriteriaProgressed_Loop2D", display: "Notification SidePanel ChallengeCriteriaProgressed Loop2D", category: "UI_Notification", kind: "loop", dim: "2d", windowMs: 8000, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SidePanel_ChallengeCriteriaProgressed_Loop2D, key: "sxa905", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SidePanel_ChallengeCriteriaProgressed_OneShot2D", display: "Notification SidePanel ChallengeCriteriaProgressed OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SidePanel_ChallengeCriteriaProgressed_OneShot2D, key: "sxa906", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SidePanel_ChallengeProgressed_OneShot2D", display: "Notification SidePanel ChallengeProgressed OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 2610, lengthText: "1.6s", lengthKey: "sxl16", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SidePanel_ChallengeProgressed_OneShot2D, key: "sxa907", catKey: "sxg53" },
{ name: "SFX_UI_Notification_SidePanel_Mastery_OneShot2D", display: "Notification SidePanel Mastery OneShot2D", category: "UI_Notification", kind: "oneshot", dim: "2d", windowMs: 3160, lengthText: "2.2s", lengthKey: "sxl22", asset: mod.RuntimeSpawn_Common.SFX_UI_Notification_SidePanel_Mastery_OneShot2D, key: "sxa908", catKey: "sxg53" },
{ name: "SFX_UI_PreRoundLobby_SquadMateAdded_OneShot2D", display: "PreRoundLobby SquadMateAdded OneShot2D", category: "UI_PreRoundLobby", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_UI_PreRoundLobby_SquadMateAdded_OneShot2D, key: "sxa909", catKey: "sxg54" },
{ name: "SFX_UI_PreRoundLobby_SquadMateRemoved_OneShot2D", display: "PreRoundLobby SquadMateRemoved OneShot2D", category: "UI_PreRoundLobby", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.2s", lengthKey: "sxl12", asset: mod.RuntimeSpawn_Common.SFX_UI_PreRoundLobby_SquadMateRemoved_OneShot2D, key: "sxa910", catKey: "sxg54" },
{ name: "SFX_UI_Scorelog_AccoladeCareerBest_OneShot2D", display: "Scorelog AccoladeCareerBest OneShot2D", category: "UI_Scorelog", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Scorelog_AccoladeCareerBest_OneShot2D, key: "sxa911", catKey: "sxg55" },
{ name: "SFX_UI_Scorelog_Accolades_AccoladeTypes_CareerBest_OneShot2D", display: "Scorelog Accolades AccoladeTypes CareerBest OneShot2D", category: "UI_Scorelog", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.3s", lengthKey: "sxl13", asset: mod.RuntimeSpawn_Common.SFX_UI_Scorelog_Accolades_AccoladeTypes_CareerBest_OneShot2D, key: "sxa912", catKey: "sxg55" },
{ name: "SFX_UI_Scorelog_Accolades_CareerBest_OneShot2D", display: "Scorelog Accolades CareerBest OneShot2D", category: "UI_Scorelog", kind: "oneshot", dim: "2d", windowMs: 3140, lengthText: "2.1s", lengthKey: "sxl21", asset: mod.RuntimeSpawn_Common.SFX_UI_Scorelog_Accolades_CareerBest_OneShot2D, key: "sxa913", catKey: "sxg55" },
{ name: "SFX_UI_Scorelog_Hide_OneShot2D", display: "Scorelog Hide OneShot2D", category: "UI_Scorelog", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Scorelog_Hide_OneShot2D, key: "sxa914", catKey: "sxg55" },
{ name: "SFX_UI_Scorelog_Show_OneShot2D", display: "Scorelog Show OneShot2D", category: "UI_Scorelog", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_Scorelog_Show_OneShot2D, key: "sxa915", catKey: "sxg55" },
{ name: "SFX_UI_Select_A_2D", display: "Select A 2D", category: "UI_Select", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_Select_A_2D, key: "sxa916", catKey: "sxg56" },
{ name: "SFX_UI_Select_B_2D", display: "Select B 2D", category: "UI_Select", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.4s", lengthKey: "sxl4", asset: mod.RuntimeSpawn_Common.SFX_UI_Select_B_2D, key: "sxa917", catKey: "sxg56" },
{ name: "SFX_UI_Select_Gear_A_2D", display: "Select Gear A 2D", category: "UI_Select", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_Select_Gear_A_2D, key: "sxa918", catKey: "sxg56" },
{ name: "SFX_UI_Select_Gear_B_2D", display: "Select Gear B 2D", category: "UI_Select", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_Select_Gear_B_2D, key: "sxa919", catKey: "sxg56" },
{ name: "SFX_UI_Select_Gear_C_2D", display: "Select Gear C 2D", category: "UI_Select", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_Select_Gear_C_2D, key: "sxa920", catKey: "sxg56" },
{ name: "SFX_UI_Select_Gear_D_2D", display: "Select Gear D 2D", category: "UI_Select", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.9s", lengthKey: "sxl9", asset: mod.RuntimeSpawn_Common.SFX_UI_Select_Gear_D_2D, key: "sxa921", catKey: "sxg56" },
{ name: "SFX_UI_Select_Gear_E_2D", display: "Select Gear E 2D", category: "UI_Select", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Select_Gear_E_2D, key: "sxa922", catKey: "sxg56" },
{ name: "SFX_UI_Select_Gear_F_2D", display: "Select Gear F 2D", category: "UI_Select", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Select_Gear_F_2D, key: "sxa923", catKey: "sxg56" },
{ name: "SFX_UI_Shared_Button_Moist_OneShot2D", display: "Shared Button Moist OneShot2D", category: "UI_Shared", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.8s", lengthKey: "sxl8", asset: mod.RuntimeSpawn_Common.SFX_UI_Shared_Button_Moist_OneShot2D, key: "sxa924", catKey: "sxg57" },
{ name: "SFX_UI_Shared_Countdown_Appear_OneShot2D", display: "Shared Countdown Appear OneShot2D", category: "UI_Shared", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.4s", lengthKey: "sxl14", asset: mod.RuntimeSpawn_Common.SFX_UI_Shared_Countdown_Appear_OneShot2D, key: "sxa925", catKey: "sxg57" },
{ name: "SFX_UI_Shared_Countdown_Tick_Final_OneShot2D", display: "Shared Countdown Tick Final OneShot2D", category: "UI_Shared", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.5s", lengthKey: "sxl15", asset: mod.RuntimeSpawn_Common.SFX_UI_Shared_Countdown_Tick_Final_OneShot2D, key: "sxa926", catKey: "sxg57" },
{ name: "SFX_UI_Shared_Countdown_Tick_OneShot2D", display: "Shared Countdown Tick OneShot2D", category: "UI_Shared", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_Shared_Countdown_Tick_OneShot2D, key: "sxa927", catKey: "sxg57" },
{ name: "SFX_UI_Shared_Countdown_Tick_Urgent_OneShot2D", display: "Shared Countdown Tick Urgent OneShot2D", category: "UI_Shared", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.1s", lengthKey: "sxl11", asset: mod.RuntimeSpawn_Common.SFX_UI_Shared_Countdown_Tick_Urgent_OneShot2D, key: "sxa928", catKey: "sxg57" },
{ name: "SFX_UI_Shared_Tutorial_Prompt_OneShot2D", display: "Shared Tutorial Prompt OneShot2D", category: "UI_Shared", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.5s", lengthKey: "sxl5", asset: mod.RuntimeSpawn_Common.SFX_UI_Shared_Tutorial_Prompt_OneShot2D, key: "sxa929", catKey: "sxg57" },
{ name: "SFX_UI_SP_Collectibles_Dogtag_OneShot2D", display: "SP Collectibles Dogtag OneShot2D", category: "UI_SP", kind: "oneshot", dim: "2d", windowMs: 3150, lengthText: "2.2s", lengthKey: "sxl22", asset: mod.RuntimeSpawn_Common.SFX_UI_SP_Collectibles_Dogtag_OneShot2D, key: "sxa930", catKey: "sxg58" },
{ name: "SFX_UI_SP_ObjectiveReceived_In_OneShot2D", display: "SP ObjectiveReceived In OneShot2D", category: "UI_SP", kind: "oneshot", dim: "2d", windowMs: 3270, lengthText: "2.3s", lengthKey: "sxl23", asset: mod.RuntimeSpawn_Common.SFX_UI_SP_ObjectiveReceived_In_OneShot2D, key: "sxa931", catKey: "sxg58" },
{ name: "SFX_UI_SP_ObjectiveReceived_Out_OneShot2D", display: "SP ObjectiveReceived Out OneShot2D", category: "UI_SP", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "1.0s", lengthKey: "sxl10", asset: mod.RuntimeSpawn_Common.SFX_UI_SP_ObjectiveReceived_Out_OneShot2D, key: "sxa932", catKey: "sxg58" },
{ name: "SFX_UI_Submenu_Close_2D", display: "Submenu Close 2D", category: "UI_Submenu", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.6s", lengthKey: "sxl6", asset: mod.RuntimeSpawn_Common.SFX_UI_Submenu_Close_2D, key: "sxa933", catKey: "sxg59" },
{ name: "SFX_UI_Submenu_Open_2D", display: "Submenu Open 2D", category: "UI_Submenu", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "0.7s", lengthKey: "sxl7", asset: mod.RuntimeSpawn_Common.SFX_UI_Submenu_Open_2D, key: "sxa934", catKey: "sxg59" },
{ name: "SFX_VOModule_OneShot2D", display: "OneShot2D", category: "VOModule_OneShot2D", kind: "oneshot", dim: "2d", windowMs: 2500, lengthText: "", lengthKey: "", asset: mod.RuntimeSpawn_Common.SFX_VOModule_OneShot2D, key: "sxa935", catKey: "sxg60" },
];
export const VFX_CATALOG: readonly VfxEntry[] = [
{ name: "FX_Airburst_Incendiary_Detonation", display: "Airburst Incendiary Detonation", category: "Airburst", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Airburst_Incendiary_Detonation, key: "sxv0", catKey: "sxg61" },
{ name: "FX_Airburst_Incendiary_Detonation_Friendly", display: "Airburst Incendiary Detonation Friendly", category: "Airburst", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Airburst_Incendiary_Detonation_Friendly, key: "sxv1", catKey: "sxg61" },
{ name: "FX_Airplane_Jetwash_Dirt", display: "Airplane Jetwash Dirt", category: "Airplane", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Airplane_Jetwash_Dirt, key: "sxv2", catKey: "sxg62" },
{ name: "FX_Airplane_Jetwash_Grass", display: "Airplane Jetwash Grass", category: "Airplane", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Airplane_Jetwash_Grass, key: "sxv3", catKey: "sxg62" },
{ name: "FX_Airplane_Jetwash_Sand", display: "Airplane Jetwash Sand", category: "Airplane", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Airplane_Jetwash_Sand, key: "sxv4", catKey: "sxg62" },
{ name: "FX_Airplane_Jetwash_Snow", display: "Airplane Jetwash Snow", category: "Airplane", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Airplane_Jetwash_Snow, key: "sxv5", catKey: "sxg62" },
{ name: "FX_Airplane_Jetwash_Water", display: "Airplane Jetwash Water", category: "Airplane", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Airplane_Jetwash_Water, key: "sxv6", catKey: "sxg62" },
{ name: "FX_AmbWar_UAV_Circling", display: "AmbWar UAV Circling", category: "AmbWar", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_AmbWar_UAV_Circling, key: "sxv7", catKey: "sxg63" },
{ name: "FX_ArtilleryStrike_Explosion_01", display: "ArtilleryStrike Explosion", category: "ArtilleryStrike", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_ArtilleryStrike_Explosion_01, key: "sxv8", catKey: "sxg64" },
{ name: "FX_ArtilleryStrike_Explosion_GS", display: "ArtilleryStrike Explosion", category: "ArtilleryStrike", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_ArtilleryStrike_Explosion_GS, key: "sxv9", catKey: "sxg64" },
{ name: "FX_ArtilleryStrike_Explosion_GS_SP_Beach", display: "ArtilleryStrike Explosion GS SP Beach", category: "ArtilleryStrike", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_ArtilleryStrike_Explosion_GS_SP_Beach, key: "sxv10", catKey: "sxg64" },
{ name: "FX_Autocannon_30mm_AP_Hit_GS", display: "Autocannon 30mm AP Hit", category: "Autocannon", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Autocannon_30mm_AP_Hit_GS, key: "sxv11", catKey: "sxg65" },
{ name: "FX_Autocannon_30mm_AP_Hit_Metal_GS", display: "Autocannon 30mm AP Hit Metal", category: "Autocannon", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Autocannon_30mm_AP_Hit_Metal_GS, key: "sxv12", catKey: "sxg65" },
{ name: "FX_AW_Distant_Cluster_Bomb_Line_Outskirts", display: "AW Distant Cluster Bomb Line Outskirts", category: "AW", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_AW_Distant_Cluster_Bomb_Line_Outskirts, key: "sxv13", catKey: "sxg66" },
{ name: "FX_BASE_Birds_Black_Circulating", display: "BASE Birds Black Circulating", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Birds_Black_Circulating, key: "sxv14", catKey: "sxg67" },
{ name: "FX_BASE_Fire_L", display: "BASE Fire L", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Fire_L, key: "sxv15", catKey: "sxg67" },
{ name: "FX_BASE_Fire_M", display: "BASE Fire M", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Fire_M, key: "sxv16", catKey: "sxg67" },
{ name: "FX_BASE_Fire_M_NoSmoke", display: "BASE Fire M NoSmoke", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Fire_M_NoSmoke, key: "sxv17", catKey: "sxg67" },
{ name: "FX_BASE_Fire_Oil_Medium", display: "BASE Fire Oil Medium", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Fire_Oil_Medium, key: "sxv18", catKey: "sxg67" },
{ name: "FX_BASE_Fire_S", display: "BASE Fire S", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Fire_S, key: "sxv19", catKey: "sxg67" },
{ name: "FX_BASE_Fire_S_NoSmoke", display: "BASE Fire S NoSmoke", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Fire_S_NoSmoke, key: "sxv20", catKey: "sxg67" },
{ name: "FX_BASE_Flies_Small", display: "BASE Flies Small", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Flies_Small, key: "sxv21", catKey: "sxg67" },
{ name: "FX_BASE_Seagull_Flock", display: "BASE Seagull Flock", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Seagull_Flock, key: "sxv22", catKey: "sxg67" },
{ name: "FX_BASE_Smoke_Column_XXL", display: "BASE SmokeFX Column XXL", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Smoke_Column_XXL, key: "sxv23", catKey: "sxg67" },
{ name: "FX_BASE_Smoke_Pillar_Black_L", display: "BASE SmokeFX Pillar Black L", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Smoke_Pillar_Black_L, key: "sxv24", catKey: "sxg67" },
{ name: "FX_BASE_Smoke_Pillar_Black_L_Dist", display: "BASE SmokeFX Pillar Black L Dist", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Smoke_Pillar_Black_L_Dist, key: "sxv25", catKey: "sxg67" },
{ name: "FX_BASE_Smoke_Pillar_White_L", display: "BASE SmokeFX Pillar White L", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Smoke_Pillar_White_L, key: "sxv26", catKey: "sxg67" },
{ name: "FX_BASE_Smoke_Soft_S_GS", display: "BASE SmokeFX Soft S", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Smoke_Soft_S_GS, key: "sxv27", catKey: "sxg67" },
{ name: "FX_BASE_Sparks_Pulse_L", display: "BASE Sparks Pulse L", category: "BASE", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BASE_Sparks_Pulse_L, key: "sxv28", catKey: "sxg67" },
{ name: "FX_BD_Huge_Horizon_Exp", display: "BD Huge Horizon Exp", category: "BD", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BD_Huge_Horizon_Exp, key: "sxv29", catKey: "sxg68" },
{ name: "FX_BD_Med_Horizon_Exp", display: "BD Med Horizon Exp", category: "BD", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BD_Med_Horizon_Exp, key: "sxv30", catKey: "sxg68" },
{ name: "FX_BD_Med_Horizon_Exp_Multi", display: "BD Med Horizon Exp Multi", category: "BD", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BD_Med_Horizon_Exp_Multi, key: "sxv31", catKey: "sxg68" },
{ name: "FX_Blackhawk_Rotor_HaloGlow", display: "Blackhawk Rotor HaloGlow", category: "Blackhawk", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Blackhawk_Rotor_HaloGlow, key: "sxv32", catKey: "sxg69" },
{ name: "FX_Blackhawk_Rotor_Vortex_Vapor", display: "Blackhawk Rotor Vortex Vapor", category: "Blackhawk", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Blackhawk_Rotor_Vortex_Vapor, key: "sxv33", catKey: "sxg69" },
{ name: "FX_BlackLocust_Tree_Branch_L_GS", display: "BlackLocust Tree Branch L", category: "BlackLocust", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BlackLocust_Tree_Branch_L_GS, key: "sxv34", catKey: "sxg70" },
{ name: "FX_Bomb_Mk82_AIR_Detonation", display: "Bomb Mk82 AIR Detonation", category: "Bomb", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Bomb_Mk82_AIR_Detonation, key: "sxv35", catKey: "sxg71" },
{ name: "FX_Bomb_Mk82_AIR_Trail_Ballute_AirStrike", display: "Bomb Mk82 AIR Trail Ballute AirStrike", category: "Bomb", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Bomb_Mk82_AIR_Trail_Ballute_AirStrike, key: "sxv36", catKey: "sxg71" },
{ name: "FX_BreachingDart_Breach_Detonation", display: "BreachingDart Breach Detonation", category: "BreachingDart", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BreachingDart_Breach_Detonation, key: "sxv37", catKey: "sxg72" },
{ name: "FX_BreachingDart_Generic_BreachthroughSmoke", display: "BreachingDart Generic BreachthroughSmoke", category: "BreachingDart", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BreachingDart_Generic_BreachthroughSmoke, key: "sxv38", catKey: "sxg72" },
{ name: "FX_BreachingDart_NoBreach_Detonation", display: "BreachingDart NoBreach Detonation", category: "BreachingDart", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_BreachingDart_NoBreach_Detonation, key: "sxv39", catKey: "sxg72" },
{ name: "FX_Building_FallingDustSand", display: "Building FallingDustSand", category: "Building", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Building_FallingDustSand, key: "sxv40", catKey: "sxg73" },
{ name: "FX_Bullet_L_Vegetation_DeadLeaves_PropDest", display: "Bullet L Vegetation DeadLeaves PropDest", category: "Bullet", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Bullet_L_Vegetation_DeadLeaves_PropDest, key: "sxv41", catKey: "sxg74" },
{ name: "FX_CAP_AmbWar_Rocket_Strike", display: "CAP AmbWar Rocket Strike", category: "CAP", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_CAP_AmbWar_Rocket_Strike, key: "sxv42", catKey: "sxg75" },
{ name: "FX_Car_Fire_M_GS", display: "Car Fire M", category: "Car", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Car_Fire_M_GS, key: "sxv43", catKey: "sxg76" },
{ name: "FX_CarFire_Bumper_01", display: "CarFire Bumper", category: "CarFire", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_CarFire_Bumper_01, key: "sxv44", catKey: "sxg77" },
{ name: "FX_CarFire_FrameCrawl", display: "CarFire FrameCrawl", category: "CarFire", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_CarFire_FrameCrawl, key: "sxv45", catKey: "sxg77" },
{ name: "FX_CarlGustaf_MK4_Impact", display: "CarlGustaf MK4 Impact", category: "CarlGustaf", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_CarlGustaf_MK4_Impact, key: "sxv46", catKey: "sxg78" },
{ name: "FX_Carrier_Explosion_Dist", display: "Carrier Explosion Dist", category: "Carrier", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Carrier_Explosion_Dist, key: "sxv47", catKey: "sxg79" },
{ name: "FX_Chaingun_30mm_HEDP_Hit", display: "Chaingun 30mm HEDP Hit", category: "Chaingun", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Chaingun_30mm_HEDP_Hit, key: "sxv48", catKey: "sxg80" },
{ name: "FX_CIN_MF_Large_Static_Fire", display: "CIN MFX Large Static Fire", category: "CIN", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_CIN_MF_Large_Static_Fire, key: "sxv49", catKey: "sxg81" },
{ name: "FX_CIN_MF_Large_Static_VortexFire", display: "CIN MFX Large Static VortexFire", category: "CIN", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_CIN_MF_Large_Static_VortexFire, key: "sxv50", catKey: "sxg81" },
{ name: "FX_CIN_MF_Medium_Static_Fire", display: "CIN MFX Medium Static Fire", category: "CIN", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_CIN_MF_Medium_Static_Fire, key: "sxv51", catKey: "sxg81" },
{ name: "FX_CIN_MF_Medium_Static_Smoke", display: "CIN MFX Medium Static SmokeFX", category: "CIN", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_CIN_MF_Medium_Static_Smoke, key: "sxv52", catKey: "sxg81" },
{ name: "FX_CIN_MF_Small_Static_Fire", display: "CIN MFX Small Static Fire", category: "CIN", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_CIN_MF_Small_Static_Fire, key: "sxv53", catKey: "sxg81" },
{ name: "FX_CIN_MF_Small_Static_Smoke", display: "CIN MFX Small Static SmokeFX", category: "CIN", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_CIN_MF_Small_Static_Smoke, key: "sxv54", catKey: "sxg81" },
{ name: "FX_CivCar_SUV_Explosion", display: "CivCar SUV Explosion", category: "CivCar", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_CivCar_SUV_Explosion, key: "sxv55", catKey: "sxg82" },
{ name: "FX_CivCar_Tire_fire_S_GS", display: "CivCar Tire fire S", category: "CivCar", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_CivCar_Tire_fire_S_GS, key: "sxv56", catKey: "sxg82" },
{ name: "FX_Cloud_Cluster", display: "Cloud Cluster", category: "Cloud", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Cloud_Cluster, key: "sxv57", catKey: "sxg83" },
{ name: "FX_Cloud_Cluster_Storm", display: "Cloud Cluster Storm", category: "Cloud", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Cloud_Cluster_Storm, key: "sxv58", catKey: "sxg83" },
{ name: "FX_Cloud_Cluster_Towering", display: "Cloud Cluster Towering", category: "Cloud", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Cloud_Cluster_Towering, key: "sxv59", catKey: "sxg83" },
{ name: "FX_Cloud_DistantBank", display: "Cloud DistantBank", category: "Cloud", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Cloud_DistantBank, key: "sxv60", catKey: "sxg83" },
{ name: "FX_Cloud_Fractus_Medium", display: "Cloud Fractus Medium", category: "Cloud", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Cloud_Fractus_Medium, key: "sxv61", catKey: "sxg83" },
{ name: "FX_Cloud_Fractus_Small", display: "Cloud Fractus Small", category: "Cloud", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Cloud_Fractus_Small, key: "sxv62", catKey: "sxg83" },
{ name: "FX_Decoy_Destruction", display: "Decoy Destruction", category: "Decoy", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Decoy_Destruction, key: "sxv63", catKey: "sxg84" },
{ name: "FX_Defib_Shock_Heal_Full", display: "Defib Shock Heal Full", category: "Defib", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Defib_Shock_Heal_Full, key: "sxv64", catKey: "sxg85" },
{ name: "FX_Defib_Shock_Heal_Half", display: "Defib Shock Heal Half", category: "Defib", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Defib_Shock_Heal_Half, key: "sxv65", catKey: "sxg85" },
{ name: "FX_Defib_Shock_Hurt_Full", display: "Defib Shock Hurt Full", category: "Defib", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Defib_Shock_Hurt_Full, key: "sxv66", catKey: "sxg85" },
{ name: "FX_Defib_Shock_Hurt_Half", display: "Defib Shock Hurt Half", category: "Defib", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Defib_Shock_Hurt_Half, key: "sxv67", catKey: "sxg85" },
{ name: "FX_DeployableCover_Deploy_Dirt", display: "DeployableCover Deploy Dirt", category: "DeployableCover", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_DeployableCover_Deploy_Dirt, key: "sxv68", catKey: "sxg86" },
{ name: "FX_DeployableCover_Destruction", display: "DeployableCover Destruction", category: "DeployableCover", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_DeployableCover_Destruction, key: "sxv69", catKey: "sxg86" },
{ name: "FX_EODBot_Active_Enemy", display: "EODBot Active Enemy", category: "EODBot", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_EODBot_Active_Enemy, key: "sxv70", catKey: "sxg87" },
{ name: "FX_EODBot_Active_Friendly", display: "EODBot Active Friendly", category: "EODBot", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_EODBot_Active_Friendly, key: "sxv71", catKey: "sxg87" },
{ name: "FX_EODBot_RepairTool_Torch_1P", display: "EODBot RepairTool Torch 1P", category: "EODBot", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_EODBot_RepairTool_Torch_1P, key: "sxv72", catKey: "sxg87" },
{ name: "FX_EODBot_RepairTool_Torch_3P", display: "EODBot RepairTool Torch 3P", category: "EODBot", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_EODBot_RepairTool_Torch_3P, key: "sxv73", catKey: "sxg87" },
{ name: "FX_Gadget_AdrenalineShot", display: "Gadget AdrenalineShot", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_AdrenalineShot, key: "sxv74", catKey: "sxg88" },
{ name: "FX_Gadget_AirburstLauncher_Detonation", display: "Gadget AirburstLauncher Detonation", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_AirburstLauncher_Detonation, key: "sxv75", catKey: "sxg88" },
{ name: "FX_Gadget_AirburstLauncher_Predicted_Line", display: "Gadget AirburstLauncher Predicted Line", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_AirburstLauncher_Predicted_Line, key: "sxv76", catKey: "sxg88" },
{ name: "FX_Gadget_AirburstLauncher_Predicted_Point", display: "Gadget AirburstLauncher Predicted Point", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_AirburstLauncher_Predicted_Point, key: "sxv77", catKey: "sxg88" },
{ name: "FX_Gadget_AirburstLauncher_Predicted_Point_GroundConnect", display: "Gadget AirburstLauncher Predicted Point GroundConnect", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_AirburstLauncher_Predicted_Point_GroundConnect, key: "sxv78", catKey: "sxg88" },
{ name: "FX_Gadget_AmmoCrate_Area", display: "Gadget AmmoCrate Area", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_AmmoCrate_Area, key: "sxv79", catKey: "sxg88" },
{ name: "FX_Gadget_AT_Mine_Detonation", display: "Gadget AT Mine Detonation", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_AT_Mine_Detonation, key: "sxv80", catKey: "sxg88" },
{ name: "FX_Gadget_AT4_Launch_1P", display: "Gadget AT4 Launch 1P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_AT4_Launch_1P, key: "sxv81", catKey: "sxg88" },
{ name: "FX_Gadget_AT4_Launch_3P", display: "Gadget AT4 Launch 3P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_AT4_Launch_3P, key: "sxv82", catKey: "sxg88" },
{ name: "FX_Gadget_AT4_Projectile_Trail", display: "Gadget AT4 Projectile Trail", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_AT4_Projectile_Trail, key: "sxv83", catKey: "sxg88" },
{ name: "FX_Gadget_Binoculars_ScopeGlint", display: "Gadget Binoculars ScopeGlint", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Binoculars_ScopeGlint, key: "sxv84", catKey: "sxg88" },
{ name: "FX_Gadget_C4_Explosives_Detonation", display: "Gadget C4 Explosives Detonation", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_C4_Explosives_Detonation, key: "sxv85", catKey: "sxg88" },
{ name: "FX_Gadget_C4_Explosives_Detonation_Underwater", display: "Gadget C4 Explosives Detonation Underwater", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_C4_Explosives_Detonation_Underwater, key: "sxv86", catKey: "sxg88" },
{ name: "FX_Gadget_Defib_LED", display: "Gadget Defib LED", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Defib_LED, key: "sxv87", catKey: "sxg88" },
{ name: "FX_Gadget_Defib_Recharge_LED", display: "Gadget Defib Recharge LED", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Defib_Recharge_LED, key: "sxv88", catKey: "sxg88" },
{ name: "FX_Gadget_DeployableMortar_Destruction", display: "Gadget DeployableMortar Destruction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_DeployableMortar_Destruction, key: "sxv89", catKey: "sxg88" },
{ name: "FX_Gadget_DeployableMortar_Detonation", display: "Gadget DeployableMortar Detonation", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_DeployableMortar_Detonation, key: "sxv90", catKey: "sxg88" },
{ name: "FX_Gadget_DeployableMortar_Detonation_Underwater", display: "Gadget DeployableMortar Detonation Underwater", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_DeployableMortar_Detonation_Underwater, key: "sxv91", catKey: "sxg88" },
{ name: "FX_Gadget_DeployableMortar_FireEffect_1P", display: "Gadget DeployableMortar FireEffect 1P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_DeployableMortar_FireEffect_1P, key: "sxv92", catKey: "sxg88" },
{ name: "FX_Gadget_DeployableMortar_FireEffect_3P", display: "Gadget DeployableMortar FireEffect 3P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_DeployableMortar_FireEffect_3P, key: "sxv93", catKey: "sxg88" },
{ name: "FX_Gadget_DeployableMortar_Projectile_Trail", display: "Gadget DeployableMortar Projectile Trail", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_DeployableMortar_Projectile_Trail, key: "sxv94", catKey: "sxg88" },
{ name: "FX_Gadget_DeployableMortar_Target_Area", display: "Gadget DeployableMortar Target Area", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_DeployableMortar_Target_Area, key: "sxv95", catKey: "sxg88" },
{ name: "FX_Gadget_Drone_Destruction", display: "Gadget Drone Destruction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Drone_Destruction, key: "sxv96", catKey: "sxg88" },
{ name: "FX_Gadget_Drone_NavLights", display: "Gadget Drone NavLights", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Drone_NavLights, key: "sxv97", catKey: "sxg88" },
{ name: "FX_Gadget_Drone_OutOfRange_Distortion", display: "Gadget Drone OutOfRange Distortion", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Drone_OutOfRange_Distortion, key: "sxv98", catKey: "sxg88" },
{ name: "FX_Gadget_Drone_ThermalVE", display: "Gadget Drone ThermalVE", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Drone_ThermalVE, key: "sxv99", catKey: "sxg88" },
{ name: "FX_Gadget_EIDOS_Active", display: "Gadget EIDOS Active", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_EIDOS_Active, key: "sxv100", catKey: "sxg88" },
{ name: "FX_Gadget_EIDOS_Destruction", display: "Gadget EIDOS Destruction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_EIDOS_Destruction, key: "sxv101", catKey: "sxg88" },
{ name: "FX_Gadget_EIDOS_Intercept_Detonation", display: "Gadget EIDOS Intercept Detonation", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_EIDOS_Intercept_Detonation, key: "sxv102", catKey: "sxg88" },
{ name: "FX_Gadget_EIDOS_Lights_Active", display: "Gadget EIDOS Lights Active", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_EIDOS_Lights_Active, key: "sxv103", catKey: "sxg88" },
{ name: "FX_Gadget_EIDOS_Lights_Standby", display: "Gadget EIDOS Lights Standby", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_EIDOS_Lights_Standby, key: "sxv104", catKey: "sxg88" },
{ name: "FX_Gadget_EIDOS_Projectile_Launch", display: "Gadget EIDOS Projectile Launch", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_EIDOS_Projectile_Launch, key: "sxv105", catKey: "sxg88" },
{ name: "FX_Gadget_EIDOS_Standby", display: "Gadget EIDOS Standby", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_EIDOS_Standby, key: "sxv106", catKey: "sxg88" },
{ name: "FX_Gadget_EODBot_Clusterbomb_Separation", display: "Gadget EODBot Clusterbomb Separation", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_EODBot_Clusterbomb_Separation, key: "sxv107", catKey: "sxg88" },
{ name: "FX_Gadget_EODBot_ClusterFragmentCharge_Detonation", display: "Gadget EODBot ClusterFragmentCharge Detonation", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_EODBot_ClusterFragmentCharge_Detonation, key: "sxv108", catKey: "sxg88" },
{ name: "FX_Gadget_EODBot_Destruction", display: "Gadget EODBot Destruction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_EODBot_Destruction, key: "sxv109", catKey: "sxg88" },
{ name: "FX_Gadget_EODBot_ObjectiveInteraction", display: "Gadget EODBot ObjectiveInteraction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_EODBot_ObjectiveInteraction, key: "sxv110", catKey: "sxg88" },
{ name: "FX_Gadget_Generic_Destruction", display: "Gadget Generic Destruction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Generic_Destruction, key: "sxv111", catKey: "sxg88" },
{ name: "FX_Gadget_Generic_Destruction_Electronic", display: "Gadget Generic Destruction Electronic", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Generic_Destruction_Electronic, key: "sxv112", catKey: "sxg88" },
{ name: "FX_Gadget_Generic_Tripod_Destruction", display: "Gadget Generic Tripod Destruction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Generic_Tripod_Destruction, key: "sxv113", catKey: "sxg88" },
{ name: "FX_Gadget_IGLA_Launch_1P", display: "Gadget IGLA Launch 1P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_IGLA_Launch_1P, key: "sxv114", catKey: "sxg88" },
{ name: "FX_Gadget_IGLA_Launch_3P", display: "Gadget IGLA Launch 3P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_IGLA_Launch_3P, key: "sxv115", catKey: "sxg88" },
{ name: "FX_Gadget_InterativeSpectator_Camera_Light_Green", display: "Gadget InterativeSpectator Camera Light Green", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_InterativeSpectator_Camera_Light_Green, key: "sxv116", catKey: "sxg88" },
{ name: "FX_Gadget_InterativeSpectator_Camera_Light_Red", display: "Gadget InterativeSpectator Camera Light Red", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_InterativeSpectator_Camera_Light_Red, key: "sxv117", catKey: "sxg88" },
{ name: "FX_Gadget_InterativeSpectator_Camera_Light_Yellow", display: "Gadget InterativeSpectator Camera Light Yellow", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_InterativeSpectator_Camera_Light_Yellow, key: "sxv118", catKey: "sxg88" },
{ name: "FX_Gadget_IntSpec_Drone_Damage_Heavy", display: "Gadget IntSpec Drone Damage Heavy", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_IntSpec_Drone_Damage_Heavy, key: "sxv119", catKey: "sxg88" },
{ name: "FX_Gadget_IntSpec_Drone_Damage_Light", display: "Gadget IntSpec Drone Damage Light", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_IntSpec_Drone_Damage_Light, key: "sxv120", catKey: "sxg88" },
{ name: "FX_Gadget_Javelin_Launch_1P", display: "Gadget Javelin Launch 1P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Javelin_Launch_1P, key: "sxv121", catKey: "sxg88" },
{ name: "FX_Gadget_Javelin_Launch_3P", display: "Gadget Javelin Launch 3P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Javelin_Launch_3P, key: "sxv122", catKey: "sxg88" },
{ name: "FX_Gadget_M320_Reload_ShellCasing", display: "Gadget M320 Reload ShellCasing", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_M320_Reload_ShellCasing, key: "sxv123", catKey: "sxg88" },
{ name: "FX_Gadget_M320_Reload_Smoke", display: "Gadget M320 Reload SmokeFX", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_M320_Reload_Smoke, key: "sxv124", catKey: "sxg88" },
{ name: "FX_Gadget_M4_SLAM_Detonation", display: "Gadget M4 SLAM Detonation", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_M4_SLAM_Detonation, key: "sxv125", catKey: "sxg88" },
{ name: "FX_Gadget_MBTLAW_Launch_1P", display: "Gadget MBTLAW Launch 1P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_MBTLAW_Launch_1P, key: "sxv126", catKey: "sxg88" },
{ name: "FX_Gadget_MBTLAW_Launch_3P", display: "Gadget MBTLAW Launch 3P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_MBTLAW_Launch_3P, key: "sxv127", catKey: "sxg88" },
{ name: "FX_Gadget_Mine_AT_Warning_Light", display: "Gadget Mine AT Warning Light", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Mine_AT_Warning_Light, key: "sxv128", catKey: "sxg88" },
{ name: "FX_Gadget_MobileRespawn_Damaged", display: "Gadget MobileRespawn Damaged", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_MobileRespawn_Damaged, key: "sxv129", catKey: "sxg88" },
{ name: "FX_Gadget_MPAPS_Active", display: "Gadget MPAPS Active", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_MPAPS_Active, key: "sxv130", catKey: "sxg88" },
{ name: "FX_Gadget_MPAPS_Destruction", display: "Gadget MPAPS Destruction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_MPAPS_Destruction, key: "sxv131", catKey: "sxg88" },
{ name: "FX_Gadget_MPAPS_Intercept_Detonation", display: "Gadget MPAPS Intercept Detonation", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_MPAPS_Intercept_Detonation, key: "sxv132", catKey: "sxg88" },
{ name: "FX_Gadget_MPAPS_Lights_Active", display: "Gadget MPAPS Lights Active", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_MPAPS_Lights_Active, key: "sxv133", catKey: "sxg88" },
{ name: "FX_Gadget_MPAPS_Lights_Standby", display: "Gadget MPAPS Lights Standby", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_MPAPS_Lights_Standby, key: "sxv134", catKey: "sxg88" },
{ name: "FX_Gadget_MPAPS_Projectile_Launch", display: "Gadget MPAPS Projectile Launch", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_MPAPS_Projectile_Launch, key: "sxv135", catKey: "sxg88" },
{ name: "FX_Gadget_MPAPS_Standby", display: "Gadget MPAPS Standby", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_MPAPS_Standby, key: "sxv136", catKey: "sxg88" },
{ name: "FX_Gadget_PTKM_EFP_Hit", display: "Gadget PTKM EFP Hit", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_PTKM_EFP_Hit, key: "sxv137", catKey: "sxg88" },
{ name: "FX_Gadget_PTKM_EFP_Trail", display: "Gadget PTKM EFP Trail", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_PTKM_EFP_Trail, key: "sxv138", catKey: "sxg88" },
{ name: "FX_Gadget_PTKM_Mine_Launch", display: "Gadget PTKM Mine Launch", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_PTKM_Mine_Launch, key: "sxv139", catKey: "sxg88" },
{ name: "FX_Gadget_PTKM_Submunition_Detonation", display: "Gadget PTKM Submunition Detonation", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_PTKM_Submunition_Detonation, key: "sxv140", catKey: "sxg88" },
{ name: "FX_Gadget_PTKM_Submunition_Trail", display: "Gadget PTKM Submunition Trail", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_PTKM_Submunition_Trail, key: "sxv141", catKey: "sxg88" },
{ name: "FX_Gadget_ReconDrone_EMP_Hit", display: "Gadget ReconDrone EMP Hit", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_ReconDrone_EMP_Hit, key: "sxv142", catKey: "sxg88" },
{ name: "FX_Gadget_ReconDrone_EMP_Weapon_Fire", display: "Gadget ReconDrone EMP Weapon Fire", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_ReconDrone_EMP_Weapon_Fire, key: "sxv143", catKey: "sxg88" },
{ name: "FX_Gadget_RemoteTurret_Box_Damage", display: "Gadget RemoteTurret Box Damage", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_RemoteTurret_Box_Damage, key: "sxv144", catKey: "sxg88" },
{ name: "FX_Gadget_RemoteTurret_Box_Damage_Top", display: "Gadget RemoteTurret Box Damage Top", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_RemoteTurret_Box_Damage_Top, key: "sxv145", catKey: "sxg88" },
{ name: "FX_Gadget_RemoteTurret_Box_WreckState", display: "Gadget RemoteTurret Box WreckState", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_RemoteTurret_Box_WreckState, key: "sxv146", catKey: "sxg88" },
{ name: "FX_Gadget_RemoteTurret_Damage_Light", display: "Gadget RemoteTurret Damage Light", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_RemoteTurret_Damage_Light, key: "sxv147", catKey: "sxg88" },
{ name: "FX_Gadget_RemoteTurret_ScreenEffect_Damage", display: "Gadget RemoteTurret ScreenEffect Damage", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_RemoteTurret_ScreenEffect_Damage, key: "sxv148", catKey: "sxg88" },
{ name: "FX_Gadget_RemoteTurret_Smoke_Open", display: "Gadget RemoteTurret SmokeFX Open", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_RemoteTurret_Smoke_Open, key: "sxv149", catKey: "sxg88" },
{ name: "FX_Gadget_RPG7V2_Launch_1P", display: "Gadget RPG7V2 Launch 1P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_RPG7V2_Launch_1P, key: "sxv150", catKey: "sxg88" },
{ name: "FX_Gadget_RPG7V2_Launch_3P", display: "Gadget RPG7V2 Launch 3P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_RPG7V2_Launch_3P, key: "sxv151", catKey: "sxg88" },
{ name: "FX_Gadget_Sabotage_01_StartSparks", display: "Gadget Sabotage 01 StartSparks", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Sabotage_01_StartSparks, key: "sxv152", catKey: "sxg88" },
{ name: "FX_Gadget_Sabotage_02_SparkLoop", display: "Gadget Sabotage 02 SparkLoop", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Sabotage_02_SparkLoop, key: "sxv153", catKey: "sxg88" },
{ name: "FX_Gadget_Sabotage_02_SparkLoop_SidePannel", display: "Gadget Sabotage 02 SparkLoop SidePannel", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Sabotage_02_SparkLoop_SidePannel, key: "sxv154", catKey: "sxg88" },
{ name: "FX_Gadget_Sabotage_03_Fizzle", display: "Gadget Sabotage 03 Fizzle", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Sabotage_03_Fizzle, key: "sxv155", catKey: "sxg88" },
{ name: "FX_Gadget_ScreenEffect_Thermal_BHOT", display: "Gadget ScreenEffect Thermal BHOT", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_ScreenEffect_Thermal_BHOT, key: "sxv156", catKey: "sxg88" },
{ name: "FX_Gadget_ScreenEffect_Thermal_WHOT", display: "Gadget ScreenEffect Thermal WHOT", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_ScreenEffect_Thermal_WHOT, key: "sxv157", catKey: "sxg88" },
{ name: "FX_Gadget_SmokeBarrage_AirBurst_Det", display: "Gadget SmokeBarrage AirBurst Det", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_SmokeBarrage_AirBurst_Det, key: "sxv158", catKey: "sxg88" },
{ name: "FX_Gadget_SmokeBarrage_Cluster_Det", display: "Gadget SmokeBarrage Cluster Det", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_SmokeBarrage_Cluster_Det, key: "sxv159", catKey: "sxg88" },
{ name: "FX_Gadget_SmokeBarrage_Cluster_Light1", display: "Gadget SmokeBarrage Cluster Light1", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_SmokeBarrage_Cluster_Light1, key: "sxv160", catKey: "sxg88" },
{ name: "FX_Gadget_SmokeBarrage_Cluster_Trail", display: "Gadget SmokeBarrage Cluster Trail", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_SmokeBarrage_Cluster_Trail, key: "sxv161", catKey: "sxg88" },
{ name: "FX_Gadget_SmokeBarrage_Cluster_VE", display: "Gadget SmokeBarrage Cluster VE", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_SmokeBarrage_Cluster_VE, key: "sxv162", catKey: "sxg88" },
{ name: "FX_Gadget_SniperDecoy_Destruction", display: "Gadget SniperDecoy Destruction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_SniperDecoy_Destruction, key: "sxv163", catKey: "sxg88" },
{ name: "FX_Gadget_SniperDecoy_LensFlare", display: "Gadget SniperDecoy LensFlare", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_SniperDecoy_LensFlare, key: "sxv164", catKey: "sxg88" },
{ name: "FX_Gadget_SpawnBeacon_Active", display: "Gadget SpawnBeacon Active", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_SpawnBeacon_Active, key: "sxv165", catKey: "sxg88" },
{ name: "FX_Gadget_SpawnBeacon_Destruction", display: "Gadget SpawnBeacon Destruction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_SpawnBeacon_Destruction, key: "sxv166", catKey: "sxg88" },
{ name: "FX_Gadget_StickyGrenade_Detonation", display: "Gadget StickyGrenade Detonation", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_StickyGrenade_Detonation, key: "sxv167", catKey: "sxg88" },
{ name: "FX_Gadget_Stinger_Launch_1P", display: "Gadget Stinger Launch 1P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Stinger_Launch_1P, key: "sxv168", catKey: "sxg88" },
{ name: "FX_Gadget_Stinger_Launch_3P", display: "Gadget Stinger Launch 3P", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Stinger_Launch_3P, key: "sxv169", catKey: "sxg88" },
{ name: "FX_Gadget_SupplyCrate_Destruction", display: "Gadget SupplyCrate Destruction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_SupplyCrate_Destruction, key: "sxv170", catKey: "sxg88" },
{ name: "FX_Gadget_SupplyCrate_Range_Indicator", display: "Gadget SupplyCrate Range Indicator", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_SupplyCrate_Range_Indicator, key: "sxv171", catKey: "sxg88" },
{ name: "FX_Gadget_SupplyCrate_Range_Indicator_Upgraded", display: "Gadget SupplyCrate Range Indicator Upgraded", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_SupplyCrate_Range_Indicator_Upgraded, key: "sxv172", catKey: "sxg88" },
{ name: "FX_Gadget_SupplyDrop_Destruction", display: "Gadget SupplyDrop Destruction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_SupplyDrop_Destruction, key: "sxv173", catKey: "sxg88" },
{ name: "FX_Gadget_Trophy_Range_Indicator", display: "Gadget Trophy Range Indicator", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_Trophy_Range_Indicator, key: "sxv174", catKey: "sxg88" },
{ name: "FX_Gadget_TUGS_Active", display: "Gadget TUGS Active", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_TUGS_Active, key: "sxv175", catKey: "sxg88" },
{ name: "FX_Gadget_TUGS_Destruction", display: "Gadget TUGS Destruction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_TUGS_Destruction, key: "sxv176", catKey: "sxg88" },
{ name: "FX_Gadget_VehicleRessuplyCrate_Destruction", display: "Gadget VehicleRessuplyCrate Destruction", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_VehicleRessuplyCrate_Destruction, key: "sxv177", catKey: "sxg88" },
{ name: "FX_Gadget_VehicleSupplyCrate_Range_Indicator", display: "Gadget VehicleSupplyCrate Range Indicator", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_VehicleSupplyCrate_Range_Indicator, key: "sxv178", catKey: "sxg88" },
{ name: "FX_Gadget_VehicleSupplyCrate_Range_Indicator_Upgraded", display: "Gadget VehicleSupplyCrate Range Indicator Upgraded", category: "Gadget", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Gadget_VehicleSupplyCrate_Range_Indicator_Upgraded, key: "sxv179", catKey: "sxg88" },
{ name: "FX_Granite_Strike_Smoke_Marker_Green", display: "Granite Strike SmokeFX Marker Green", category: "Granite", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Granite_Strike_Smoke_Marker_Green, key: "sxv180", catKey: "sxg89" },
{ name: "FX_Granite_Strike_Smoke_Marker_Red", display: "Granite Strike SmokeFX Marker Red", category: "Granite", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Granite_Strike_Smoke_Marker_Red, key: "sxv181", catKey: "sxg89" },
{ name: "FX_Granite_Strike_Smoke_Marker_Violet", display: "Granite Strike SmokeFX Marker Violet", category: "Granite", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Granite_Strike_Smoke_Marker_Violet, key: "sxv182", catKey: "sxg89" },
{ name: "FX_Granite_Strike_Smoke_Marker_Yellow", display: "Granite Strike SmokeFX Marker Yellow", category: "Granite", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Granite_Strike_Smoke_Marker_Yellow, key: "sxv183", catKey: "sxg89" },
{ name: "FX_Grenade_40mm_AT_Detonation", display: "Grenade 40mm AT Detonation", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_40mm_AT_Detonation, key: "sxv184", catKey: "sxg90" },
{ name: "FX_Grenade_40mm_HE_Detonation", display: "Grenade 40mm HE Detonation", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_40mm_HE_Detonation, key: "sxv185", catKey: "sxg90" },
{ name: "FX_Grenade_40mm_HE_Detonation_Underwater", display: "Grenade 40mm HE Detonation Underwater", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_40mm_HE_Detonation_Underwater, key: "sxv186", catKey: "sxg90" },
{ name: "FX_Grenade_40mm_Thermobaric_Detonation", display: "Grenade 40mm Thermobaric Detonation", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_40mm_Thermobaric_Detonation, key: "sxv187", catKey: "sxg90" },
{ name: "FX_Grenade_AntiTank_Detonation", display: "Grenade AntiTank Detonation", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_AntiTank_Detonation, key: "sxv188", catKey: "sxg90" },
{ name: "FX_Grenade_AntiTank_Trail", display: "Grenade AntiTank Trail", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_AntiTank_Trail, key: "sxv189", catKey: "sxg90" },
{ name: "FX_Grenade_BreachingDart_Stuck", display: "Grenade BreachingDart Stuck", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_BreachingDart_Stuck, key: "sxv190", catKey: "sxg90" },
{ name: "FX_Grenade_BreachingDart_Trail_Flashbang", display: "Grenade BreachingDart Trail Flashbang", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_BreachingDart_Trail_Flashbang, key: "sxv191", catKey: "sxg90" },
{ name: "FX_Grenade_BreachingDartFlashbang_BurnIn_ScreenEffect", display: "Grenade BreachingDartFlashbang BurnIn ScreenEffect", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_BreachingDartFlashbang_BurnIn_ScreenEffect, key: "sxv192", catKey: "sxg90" },
{ name: "FX_Grenade_BreachingDartFlashbang_Detonation", display: "Grenade BreachingDartFlashbang Detonation", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_BreachingDartFlashbang_Detonation, key: "sxv193", catKey: "sxg90" },
{ name: "FX_Grenade_Concussion_Detonation", display: "Grenade Concussion Detonation", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Concussion_Detonation, key: "sxv194", catKey: "sxg90" },
{ name: "FX_Grenade_Concussion_ScreenEffect", display: "Grenade Concussion ScreenEffect", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Concussion_ScreenEffect, key: "sxv195", catKey: "sxg90" },
{ name: "FX_Grenade_Flashbang_BurnIn_ScreenEffect", display: "Grenade Flashbang BurnIn ScreenEffect", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Flashbang_BurnIn_ScreenEffect, key: "sxv196", catKey: "sxg90" },
{ name: "FX_Grenade_Flashbang_Detonation", display: "Grenade Flashbang Detonation", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Flashbang_Detonation, key: "sxv197", catKey: "sxg90" },
{ name: "FX_Grenade_Flashbang_ScreenEffect", display: "Grenade Flashbang ScreenEffect", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Flashbang_ScreenEffect, key: "sxv198", catKey: "sxg90" },
{ name: "FX_Grenade_Fragmentation_Detonation", display: "Grenade Fragmentation Detonation", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Fragmentation_Detonation, key: "sxv199", catKey: "sxg90" },
{ name: "FX_Grenade_Fragmentation_Detonation_Underwater", display: "Grenade Fragmentation Detonation Underwater", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Fragmentation_Detonation_Underwater, key: "sxv200", catKey: "sxg90" },
{ name: "FX_Grenade_Fragmentation_ImpactGrenade_Detonation", display: "Grenade Fragmentation ImpactGrenade Detonation", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Fragmentation_ImpactGrenade_Detonation, key: "sxv201", catKey: "sxg90" },
{ name: "FX_Grenade_Fragmentation_MiniV40_Detonation", display: "Grenade Fragmentation MiniV40 Detonation", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Fragmentation_MiniV40_Detonation, key: "sxv202", catKey: "sxg90" },
{ name: "FX_Grenade_Fragmentation_Trail", display: "Grenade Fragmentation Trail", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Fragmentation_Trail, key: "sxv203", catKey: "sxg90" },
{ name: "FX_Grenade_Incendiary_Detonation", display: "Grenade Incendiary Detonation", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Incendiary_Detonation, key: "sxv204", catKey: "sxg90" },
{ name: "FX_Grenade_Incendiary_Trail", display: "Grenade Incendiary Trail", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Incendiary_Trail, key: "sxv205", catKey: "sxg90" },
{ name: "FX_Grenade_M67_Fragmentation_Trail", display: "Grenade M67 Fragmentation Trail", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_M67_Fragmentation_Trail, key: "sxv206", catKey: "sxg90" },
{ name: "FX_Grenade_M84_Flashbang_Trail", display: "Grenade M84 Flashbang Trail", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_M84_Flashbang_Trail, key: "sxv207", catKey: "sxg90" },
{ name: "FX_Grenade_MK32A_Concussion_Trail", display: "Grenade MK32A Concussion Trail", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_MK32A_Concussion_Trail, key: "sxv208", catKey: "sxg90" },
{ name: "FX_Grenade_RGO_Impact_Trail", display: "Grenade RGO Impact Trail", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_RGO_Impact_Trail, key: "sxv209", catKey: "sxg90" },
{ name: "FX_Grenade_SignalSmoke", display: "Grenade SignalSmoke", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_SignalSmoke, key: "sxv210", catKey: "sxg90" },
{ name: "FX_Grenade_SignalSmoke_INV", display: "Grenade SignalSmoke INV", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_SignalSmoke_INV, key: "sxv211", catKey: "sxg90" },
{ name: "FX_Grenade_Smoke_Detonation", display: "Grenade SmokeFX Detonation", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Smoke_Detonation, key: "sxv212", catKey: "sxg90" },
{ name: "FX_Grenade_Smoke_Detonation_Upgraded", display: "Grenade SmokeFX Detonation Upgraded", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Smoke_Detonation_Upgraded, key: "sxv213", catKey: "sxg90" },
{ name: "FX_Grenade_Smoke_Trail", display: "Grenade SmokeFX Trail", category: "Grenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Grenade_Smoke_Trail, key: "sxv214", catKey: "sxg90" },
{ name: "FX_Impact_LoadoutCrate_Bricks", display: "Impact LoadoutCrate Bricks", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_LoadoutCrate_Bricks, key: "sxv215", catKey: "sxg91" },
{ name: "FX_Impact_LoadoutCrate_Dirt", display: "Impact LoadoutCrate Dirt", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_LoadoutCrate_Dirt, key: "sxv216", catKey: "sxg91" },
{ name: "FX_Impact_LoadoutCrate_Generic", display: "Impact LoadoutCrate Generic", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_LoadoutCrate_Generic, key: "sxv217", catKey: "sxg91" },
{ name: "FX_Impact_LoadoutCrate_Metal", display: "Impact LoadoutCrate Metal", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_LoadoutCrate_Metal, key: "sxv218", catKey: "sxg91" },
{ name: "FX_Impact_LoadoutCrate_Mud", display: "Impact LoadoutCrate Mud", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_LoadoutCrate_Mud, key: "sxv219", catKey: "sxg91" },
{ name: "FX_Impact_LoadoutCrate_Sand", display: "Impact LoadoutCrate Sand", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_LoadoutCrate_Sand, key: "sxv220", catKey: "sxg91" },
{ name: "FX_Impact_LoadoutCrate_Stone", display: "Impact LoadoutCrate Stone", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_LoadoutCrate_Stone, key: "sxv221", catKey: "sxg91" },
{ name: "FX_Impact_LoadoutCrate_Wood", display: "Impact LoadoutCrate Wood", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_LoadoutCrate_Wood, key: "sxv222", catKey: "sxg91" },
{ name: "FX_Impact_LootCrate_Dirt", display: "Impact LootCrate Dirt", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_LootCrate_Dirt, key: "sxv223", catKey: "sxg91" },
{ name: "FX_Impact_LootCrate_Generic", display: "Impact LootCrate Generic", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_LootCrate_Generic, key: "sxv224", catKey: "sxg91" },
{ name: "FX_Impact_SafeImpact_Brick", display: "Impact SafeImpact Brick", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SafeImpact_Brick, key: "sxv225", catKey: "sxg91" },
{ name: "FX_Impact_SafeImpact_Dirt", display: "Impact SafeImpact Dirt", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SafeImpact_Dirt, key: "sxv226", catKey: "sxg91" },
{ name: "FX_Impact_SafeImpact_Generic", display: "Impact SafeImpact Generic", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SafeImpact_Generic, key: "sxv227", catKey: "sxg91" },
{ name: "FX_Impact_SafeImpact_Gravel", display: "Impact SafeImpact Gravel", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SafeImpact_Gravel, key: "sxv228", catKey: "sxg91" },
{ name: "FX_Impact_SafeImpact_Metal", display: "Impact SafeImpact Metal", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SafeImpact_Metal, key: "sxv229", catKey: "sxg91" },
{ name: "FX_Impact_SafeImpact_Mud", display: "Impact SafeImpact Mud", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SafeImpact_Mud, key: "sxv230", catKey: "sxg91" },
{ name: "FX_Impact_SafeImpact_Sand", display: "Impact SafeImpact Sand", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SafeImpact_Sand, key: "sxv231", catKey: "sxg91" },
{ name: "FX_Impact_SafeImpact_Water", display: "Impact SafeImpact Water", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SafeImpact_Water, key: "sxv232", catKey: "sxg91" },
{ name: "FX_Impact_SafeImpact_Wood", display: "Impact SafeImpact Wood", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SafeImpact_Wood, key: "sxv233", catKey: "sxg91" },
{ name: "FX_Impact_SupplyDrop_Brick", display: "Impact SupplyDrop Brick", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SupplyDrop_Brick, key: "sxv234", catKey: "sxg91" },
{ name: "FX_Impact_SupplyDrop_Dirt", display: "Impact SupplyDrop Dirt", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SupplyDrop_Dirt, key: "sxv235", catKey: "sxg91" },
{ name: "FX_Impact_SupplyDrop_Gravel", display: "Impact SupplyDrop Gravel", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SupplyDrop_Gravel, key: "sxv236", catKey: "sxg91" },
{ name: "FX_Impact_Supplydrop_Metal", display: "Impact Supplydrop Metal", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_Supplydrop_Metal, key: "sxv237", catKey: "sxg91" },
{ name: "FX_Impact_SupplyDrop_Mud", display: "Impact SupplyDrop Mud", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SupplyDrop_Mud, key: "sxv238", catKey: "sxg91" },
{ name: "FX_Impact_SupplyDrop_Sand", display: "Impact SupplyDrop Sand", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SupplyDrop_Sand, key: "sxv239", catKey: "sxg91" },
{ name: "FX_Impact_SupplyDrop_Water", display: "Impact SupplyDrop Water", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SupplyDrop_Water, key: "sxv240", catKey: "sxg91" },
{ name: "FX_Impact_SupplyDrop_Wood", display: "Impact SupplyDrop Wood", category: "Impact", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Impact_SupplyDrop_Wood, key: "sxv241", catKey: "sxg91" },
{ name: "FX_LoadoutCrate_AirSpawn", display: "LoadoutCrate AirSpawn", category: "LoadoutCrate", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_LoadoutCrate_AirSpawn, key: "sxv242", catKey: "sxg92" },
{ name: "FX_LoadoutCrate_Drop_Trails", display: "LoadoutCrate Drop Trails", category: "LoadoutCrate", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_LoadoutCrate_Drop_Trails, key: "sxv243", catKey: "sxg92" },
{ name: "FX_MF_M320_1P", display: "MFX M320 1P", category: "MF", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_MF_M320_1P, key: "sxv244", catKey: "sxg93" },
{ name: "FX_MF_M320_3P", display: "MFX M320 3P", category: "MF", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_MF_M320_3P, key: "sxv245", catKey: "sxg93" },
{ name: "FX_MF_TRR8_1P", display: "MFX TRR8 1P", category: "MF", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_MF_TRR8_1P, key: "sxv246", catKey: "sxg93" },
{ name: "FX_MF_TRR8_3P", display: "MFX TRR8 3P", category: "MF", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_MF_TRR8_3P, key: "sxv247", catKey: "sxg93" },
{ name: "FX_Mine_M18_Claymore_Detonation", display: "Mine M18 Claymore Detonation", category: "Mine", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Mine_M18_Claymore_Detonation, key: "sxv248", catKey: "sxg94" },
{ name: "FX_Mine_M18_Claymore_Laser_Tripwire", display: "Mine M18 Claymore Laser Tripwire", category: "Mine", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Mine_M18_Claymore_Laser_Tripwire, key: "sxv249", catKey: "sxg94" },
{ name: "FX_Missile_IGLA_Trail", display: "Missile IGLA Trail", category: "Missile", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Missile_IGLA_Trail, key: "sxv250", catKey: "sxg95" },
{ name: "FX_Missile_Javelin", display: "Missile Javelin", category: "Missile", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Missile_Javelin, key: "sxv251", catKey: "sxg95" },
{ name: "FX_Missile_Javelin_Detonation", display: "Missile Javelin Detonation", category: "Missile", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Missile_Javelin_Detonation, key: "sxv252", catKey: "sxg95" },
{ name: "FX_Missile_Javelin_Detonation_Underwater", display: "Missile Javelin Detonation Underwater", category: "Missile", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Missile_Javelin_Detonation_Underwater, key: "sxv253", catKey: "sxg95" },
{ name: "FX_Missile_Javelin_Launch_SmokeTrail", display: "Missile Javelin Launch SmokeTrail", category: "Missile", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Missile_Javelin_Launch_SmokeTrail, key: "sxv254", catKey: "sxg95" },
{ name: "FX_Missile_MBTLAW_Hit", display: "Missile MBTLAW Hit", category: "Missile", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Missile_MBTLAW_Hit, key: "sxv255", catKey: "sxg95" },
{ name: "FX_Missile_MBTLAW_Hit_Critical", display: "Missile MBTLAW Hit Critical", category: "Missile", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Missile_MBTLAW_Hit_Critical, key: "sxv256", catKey: "sxg95" },
{ name: "FX_Missile_MBTLAW_Hit_Glancing", display: "Missile MBTLAW Hit Glancing", category: "Missile", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Missile_MBTLAW_Hit_Glancing, key: "sxv257", catKey: "sxg95" },
{ name: "FX_Missile_MBTLAW_Trail", display: "Missile MBTLAW Trail", category: "Missile", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Missile_MBTLAW_Trail, key: "sxv258", catKey: "sxg95" },
{ name: "FX_Missile_Stinger_Trail", display: "Missile Stinger Trail", category: "Missile", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Missile_Stinger_Trail, key: "sxv259", catKey: "sxg95" },
{ name: "FX_Panzerfaust_Projectile_Stabilizers", display: "Panzerfaust Projectile Stabilizers", category: "Panzerfaust", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Panzerfaust_Projectile_Stabilizers, key: "sxv260", catKey: "sxg96" },
{ name: "FX_ProjectileTrail_BreachingDart", display: "ProjectileTrail BreachingDart", category: "ProjectileTrail", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_ProjectileTrail_BreachingDart, key: "sxv261", catKey: "sxg97" },
{ name: "FX_ProjectileTrail_M320_Incendiary", display: "ProjectileTrail M320 Incendiary", category: "ProjectileTrail", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_ProjectileTrail_M320_Incendiary, key: "sxv262", catKey: "sxg97" },
{ name: "FX_ProjectileTrail_M320_Lethal", display: "ProjectileTrail M320 Lethal", category: "ProjectileTrail", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_ProjectileTrail_M320_Lethal, key: "sxv263", catKey: "sxg97" },
{ name: "FX_ProjectileTrail_M320_NonLethal", display: "ProjectileTrail M320 NonLethal", category: "ProjectileTrail", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_ProjectileTrail_M320_NonLethal, key: "sxv264", catKey: "sxg97" },
{ name: "FX_ProximityGrenade_Ping_Flash", display: "ProximityGrenade Ping Flash", category: "ProximityGrenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_ProximityGrenade_Ping_Flash, key: "sxv265", catKey: "sxg98" },
{ name: "FX_ProximityGrenade_Trail", display: "ProximityGrenade Trail", category: "ProximityGrenade", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_ProximityGrenade_Trail, key: "sxv266", catKey: "sxg98" },
{ name: "FX_RepairTool_FullyHealed", display: "RepairTool FullyHealed", category: "RepairTool", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_RepairTool_FullyHealed, key: "sxv267", catKey: "sxg99" },
{ name: "FX_RepairTool_Overheat_1P", display: "RepairTool Overheat 1P", category: "RepairTool", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_RepairTool_Overheat_1P, key: "sxv268", catKey: "sxg99" },
{ name: "FX_RepairTool_Overheat_3P", display: "RepairTool Overheat 3P", category: "RepairTool", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_RepairTool_Overheat_3P, key: "sxv269", catKey: "sxg99" },
{ name: "FX_RepairTool_Sparks_1P", display: "RepairTool Sparks 1P", category: "RepairTool", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_RepairTool_Sparks_1P, key: "sxv270", catKey: "sxg99" },
{ name: "FX_RepairTool_Sparks_3P", display: "RepairTool Sparks 3P", category: "RepairTool", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_RepairTool_Sparks_3P, key: "sxv271", catKey: "sxg99" },
{ name: "FX_RepairTool_Sparks_Damage", display: "RepairTool Sparks Damage", category: "RepairTool", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_RepairTool_Sparks_Damage, key: "sxv272", catKey: "sxg99" },
{ name: "FX_RepairTool_Torch_1P", display: "RepairTool Torch 1P", category: "RepairTool", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_RepairTool_Torch_1P, key: "sxv273", catKey: "sxg99" },
{ name: "FX_RepairTool_Torch_3P", display: "RepairTool Torch 3P", category: "RepairTool", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_RepairTool_Torch_3P, key: "sxv274", catKey: "sxg99" },
{ name: "FX_Rocket_ArmorPiercing_Hit_Metal", display: "Rocket ArmorPiercing Hit Metal", category: "Rocket", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Rocket_ArmorPiercing_Hit_Metal, key: "sxv275", catKey: "sxg100" },
{ name: "FX_Rocket_RPG7V2_Dud", display: "Rocket RPG7V2 Dud", category: "Rocket", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Rocket_RPG7V2_Dud, key: "sxv276", catKey: "sxg100" },
{ name: "FX_Rocket_RPG7V2_Hit", display: "Rocket RPG7V2 Hit", category: "Rocket", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Rocket_RPG7V2_Hit, key: "sxv277", catKey: "sxg100" },
{ name: "FX_Rocket_RPG7V2_Hit_Critical", display: "Rocket RPG7V2 Hit Critical", category: "Rocket", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Rocket_RPG7V2_Hit_Critical, key: "sxv278", catKey: "sxg100" },
{ name: "FX_Rocket_RPG7V2_Hit_Glancing", display: "Rocket RPG7V2 Hit Glancing", category: "Rocket", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Rocket_RPG7V2_Hit_Glancing, key: "sxv279", catKey: "sxg100" },
{ name: "FX_Rocket_RPG7V2_Trail", display: "Rocket RPG7V2 Trail", category: "Rocket", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Rocket_RPG7V2_Trail, key: "sxv280", catKey: "sxg100" },
{ name: "FX_Rocket_RPG7V2_Trail_SP", display: "Rocket RPG7V2 Trail SP", category: "Rocket", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Rocket_RPG7V2_Trail_SP, key: "sxv281", catKey: "sxg100" },
{ name: "FX_ShellEjection_DP12_12g_Buckshot", display: "ShellEjection DP12 12g Buckshot", category: "ShellEjection", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_ShellEjection_DP12_12g_Buckshot, key: "sxv282", catKey: "sxg101" },
{ name: "FX_Smoke_Marker_Custom", display: "SmokeFX Marker Custom", category: "Smoke", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Smoke_Marker_Custom, key: "sxv283", catKey: "sxg102" },
{ name: "FX_Snow_BlowingSnow_L_01_TerrainSnap", display: "Snow BlowingSnow L", category: "Snow", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Snow_BlowingSnow_L_01_TerrainSnap, key: "sxv284", catKey: "sxg103" },
{ name: "FX_Snow_BlowingSnow_M_01_TerrainSnap", display: "Snow BlowingSnow M", category: "Snow", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Snow_BlowingSnow_M_01_TerrainSnap, key: "sxv285", catKey: "sxg103" },
{ name: "FX_Snow_BlowingSnow_S_01", display: "Snow BlowingSnow S", category: "Snow", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Snow_BlowingSnow_S_01, key: "sxv286", catKey: "sxg103" },
{ name: "FX_Snow_BlowingSnow_S_01_inShadow", display: "Snow BlowingSnow S 01 inShadow", category: "Snow", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Snow_BlowingSnow_S_01_inShadow, key: "sxv287", catKey: "sxg103" },
{ name: "FX_Snow_BlowingSnow_XS_01", display: "Snow BlowingSnow XS", category: "Snow", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Snow_BlowingSnow_XS_01, key: "sxv288", catKey: "sxg103" },
{ name: "FX_Snow_DriftingSnow_Rooftop_Bridge_01", display: "Snow DriftingSnow Rooftop Bridge", category: "Snow", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Snow_DriftingSnow_Rooftop_Bridge_01, key: "sxv289", catKey: "sxg103" },
{ name: "FX_Snow_DriftingSnow_Rooftop_S_01", display: "Snow DriftingSnow Rooftop S", category: "Snow", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Snow_DriftingSnow_Rooftop_S_01, key: "sxv290", catKey: "sxg103" },
{ name: "FX_Snow_WhiteLeaves_01", display: "Snow WhiteLeaves", category: "Snow", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Snow_WhiteLeaves_01, key: "sxv291", catKey: "sxg103" },
{ name: "FX_SoldierScreen_HealingStarted", display: "SoldierScreen HealingStarted", category: "SoldierScreen", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_SoldierScreen_HealingStarted, key: "sxv292", catKey: "sxg104" },
{ name: "FX_SP_Glint_Collectable", display: "SP Glint Collectable", category: "SP", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_SP_Glint_Collectable, key: "sxv293", catKey: "sxg105" },
{ name: "FX_Sparks", display: "Sparks", category: "Sparks", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Sparks, key: "sxv294", catKey: "sxg106" },
{ name: "FX_SupplyVehicleStation_Range_Indicator", display: "SupplyVehicleStation Range Indicator", category: "SupplyVehicleStation", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_SupplyVehicleStation_Range_Indicator, key: "sxv295", catKey: "sxg107" },
{ name: "FX_ThrowingKnife_Trail", display: "ThrowingKnife Trail", category: "ThrowingKnife", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_ThrowingKnife_Trail, key: "sxv296", catKey: "sxg108" },
{ name: "FX_ThrowingKnife_Trail_Friendly", display: "ThrowingKnife Trail Friendly", category: "ThrowingKnife", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_ThrowingKnife_Trail_Friendly, key: "sxv297", catKey: "sxg108" },
{ name: "FX_TracerDart_Projectile_Glow", display: "TracerDart Projectile Glow", category: "TracerDart", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_TracerDart_Projectile_Glow, key: "sxv298", catKey: "sxg109" },
{ name: "FX_Vehicle_Car_Destruction_Death_Explosion_PTV", display: "Vehicle Car Destruction Death Explosion PTV", category: "Vehicle", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Vehicle_Car_Destruction_Death_Explosion_PTV, key: "sxv299", catKey: "sxg110" },
{ name: "FX_Vehicle_CriticalState_PTV", display: "Vehicle CriticalState PTV", category: "Vehicle", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Vehicle_CriticalState_PTV, key: "sxv300", catKey: "sxg110" },
{ name: "FX_Vehicle_Damage_PTV_Critical", display: "Vehicle Damage PTV Critical", category: "Vehicle", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Vehicle_Damage_PTV_Critical, key: "sxv301", catKey: "sxg110" },
{ name: "FX_Vehicle_Damage_PTV_Heavy", display: "Vehicle Damage PTV Heavy", category: "Vehicle", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Vehicle_Damage_PTV_Heavy, key: "sxv302", catKey: "sxg110" },
{ name: "FX_Vehicle_Damage_PTV_Light", display: "Vehicle Damage PTV Light", category: "Vehicle", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Vehicle_Damage_PTV_Light, key: "sxv303", catKey: "sxg110" },
{ name: "FX_Vehicle_InstSpec_Drone_Explosion", display: "Vehicle InstSpec Drone Explosion", category: "Vehicle", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Vehicle_InstSpec_Drone_Explosion, key: "sxv304", catKey: "sxg110" },
{ name: "FX_Vehicle_PTV_WheelTracks_GroundDecal", display: "Vehicle PTV WheelTracks GroundDecal", category: "Vehicle", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Vehicle_PTV_WheelTracks_GroundDecal, key: "sxv305", catKey: "sxg110" },
{ name: "FX_Vehicle_Sabotage_Sequence", display: "Vehicle Sabotage Sequence", category: "Vehicle", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Vehicle_Sabotage_Sequence, key: "sxv306", catKey: "sxg110" },
{ name: "FX_Vehicle_Wreck_PTV", display: "Vehicle Wreck PTV", category: "Vehicle", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Vehicle_Wreck_PTV, key: "sxv307", catKey: "sxg110" },
{ name: "FX_Vehicle_Wreck_PTV_Calm", display: "Vehicle Wreck PTV Calm", category: "Vehicle", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_Vehicle_Wreck_PTV_Calm, key: "sxv308", catKey: "sxg110" },
{ name: "VFX_Launchers_GroundShockwave_Dirt", display: "Launchers GroundShockwave Dirt", category: "VFX", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.VFX_Launchers_GroundShockwave_Dirt, key: "sxv309", catKey: "sxg111" },
{ name: "VFX_Launchers_GroundShockwave_Grass", display: "Launchers GroundShockwave Grass", category: "VFX", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.VFX_Launchers_GroundShockwave_Grass, key: "sxv310", catKey: "sxg111" },
{ name: "FX_WireGuidedMissile_SpooledWire", display: "WireGuidedMissile SpooledWire", category: "WireGuidedMissile", enum: "RuntimeSpawn_Common", asset: mod.RuntimeSpawn_Common.FX_WireGuidedMissile_SpooledWire, key: "sxv311", catKey: "sxg112" },
];
export interface TextPair {
readonly key: string;
readonly text: string;
}
export const SFX_TEXT: readonly TextPair[] = [
{ key: "sxa0", text: "Alarm" },
{ key: "sxa1", text: "Buildings CrowsNest Collapse All OneShot3D" },
{ key: "sxa2", text: "Buildings CrowsNest Collapse Close OneShot3D" },
{ key: "sxa3", text: "Buildings CrowsNest Collapse Distant OneShot3D" },
{ key: "sxa4", text: "Buildings CrowsNest Collapse LFE OneShot3D" },
{ key: "sxa5", text: "Buildings CrowsNest Preamble Distant OneShot3D" },
{ key: "sxa6", text: "Buildings CrowsNest Preamble LFE OneShot3D" },
{ key: "sxa7", text: "Buildings CrowsNest Preamble OneShot3D" },
{ key: "sxa8", text: "Buildings GasStation Collapse Distant OneShot3D" },
{ key: "sxa9", text: "Buildings GasStation Collapse LFE OneShot3D" },
{ key: "sxa10", text: "Buildings GasStation Collapse OneShot3D" },
{ key: "sxa11", text: "Buildings HouseCollapse OneShot3D" },
{ key: "sxa12", text: "Buildings SolarArray Large Distant OneShot3D" },
{ key: "sxa13", text: "Buildings SolarArray Large LFE OneShot3D" },
{ key: "sxa14", text: "Buildings SolarArray Large OneShot3D" },
{ key: "sxa15", text: "Buildings SolarArray Medium Distant OneShot3D" },
{ key: "sxa16", text: "Buildings SolarArray Medium LFE OneShot3D" },
{ key: "sxa17", text: "Buildings SolarArray Medium OneShot3D" },
{ key: "sxa18", text: "Fuse Loop EngineCrackle SimpleLoop3D" },
{ key: "sxa19", text: "Fuse Loop GasFire SimpleLoop3D" },
{ key: "sxa20", text: "Fuse Loop LingeringWreckFire SimpleLoop3D" },
{ key: "sxa21", text: "Fuse Loop WreckFire SimpleLoop3D" },
{ key: "sxa22", text: "Fuse OneShot GasFireIgnition OneShot3D" },
{ key: "sxa23", text: "Fuse OneShot OilSpill OneShot3D" },
{ key: "sxa24", text: "Fuse OneShot VehicleIgnition OneShot3D" },
{ key: "sxa25", text: "Impacts Brick Small OneShot3D" },
{ key: "sxa26", text: "Impacts BrickWall OneShot3D" },
{ key: "sxa27", text: "Impacts Concrete Prop OneShot3D" },
{ key: "sxa28", text: "Impacts Metal Prop OneShot3D" },
{ key: "sxa29", text: "Impacts Metal Structural Medium OneShot3D" },
{ key: "sxa30", text: "Impacts Plaster Structural OneShot3D" },
{ key: "sxa31", text: "Impacts Plastic Prop OneShot3D" },
{ key: "sxa32", text: "Impacts Tile Large OneShot3D" },
{ key: "sxa33", text: "Impacts Vehicle Car OneShot3D" },
{ key: "sxa34", text: "Old Ceramic Generic OneShot3D" },
{ key: "sxa35", text: "PreAmble Brick OneShot3D" },
{ key: "sxa36", text: "Props FX Electric PropExplosionPowerline Medium OneShot3D" },
{ key: "sxa37", text: "Props Liquids WaterTank Large OneShot3D" },
{ key: "sxa38", text: "Props Paper OneShot3D" },
{ key: "sxa39", text: "Props Special Piano DestroyedState OneShot3D" },
{ key: "sxa40", text: "Props Special Piano OneShot3D" },
{ key: "sxa41", text: "Props Wood Generic Small OneShot3D" },
{ key: "sxa42", text: "Structural CloseDebris Generic OneShot3D" },
{ key: "sxa43", text: "Structural CloseDebris Wood OneShot3D" },
{ key: "sxa44", text: "Structural Debrispile OneShot3D" },
{ key: "sxa45", text: "Structural Metal GasStation OneShot3D" },
{ key: "sxa46", text: "Structures BrickWall Small Close OneShot3D" },
{ key: "sxa47", text: "Tree Dead Collision Large OneShot3D" },
{ key: "sxa48", text: "Tree Leafy Collision Large OneShot3D" },
{ key: "sxa49", text: "Tree Leafy Collision Medium OneShot3D" },
{ key: "sxa50", text: "Tree Leafy Falling Medium SimpleLoop3D" },
{ key: "sxa51", text: "Tree Leafy Start Large OneShot3D" },
{ key: "sxa52", text: "Tree Leafy Start Medium OneShot3D" },
{ key: "sxa53", text: "Tree Palm Collision Large OneShot3D" },
{ key: "sxa54", text: "Tree Palm Falling Large SimpleLoop3D" },
{ key: "sxa55", text: "Tree Palm Falling Medium SimpleLoop3D" },
{ key: "sxa56", text: "Tree Palm Start Large SimpleLoop3D" },
{ key: "sxa57", text: "Tree PineLoblolly Collision Large OneShot3D" },
{ key: "sxa58", text: "Tree PineLoblolly Collision Medium OneShot3D" },
{ key: "sxa59", text: "Tree PineLoblolly Collision Small OneShot3D" },
{ key: "sxa60", text: "Tree PineLoblolly Falling Large SimpleLoop3D" },
{ key: "sxa61", text: "Tree PineLoblolly Falling Small SimpleLoop3D" },
{ key: "sxa62", text: "Tree PineLoblolly Start Large OneShot3D" },
{ key: "sxa63", text: "Tree PineLoblolly Start Small OneShot3D" },
{ key: "sxa64", text: "Tree Poplar Falling Small SimpleLoop3D" },
{ key: "sxa65", text: "Tree Poplar Start Medium OneShot3D" },
{ key: "sxa66", text: "Tree Walnut Start Small OneShot3D" },
{ key: "sxa67", text: "Tree Whoosh Large SimpleLoop3D" },
{ key: "sxa68", text: "Tree WhooshTest SimpleLoop3D" },
{ key: "sxa69", text: "AdrenalineShot 1pExperience OneShot2D" },
{ key: "sxa70", text: "AdrenalineShot 1pExperience SimpleLoop2D" },
{ key: "sxa71", text: "AdrenalineShot 1pRiser OneShot2D" },
{ key: "sxa72", text: "AdrenalineShot 1pStop OneShot2D" },
{ key: "sxa73", text: "AdrenalineShot Commando 1pExperience OneShot2D" },
{ key: "sxa74", text: "AdrenalineShot Effort Female OneShot2D" },
{ key: "sxa75", text: "AdrenalineShot Effort Male OneShot2D" },
{ key: "sxa76", text: "AdrenalineShot Start OneShot2D" },
{ key: "sxa77", text: "AdrenalineShot Start OneShot3D" },
{ key: "sxa78", text: "AdrenalineShot Stop Early OneShot2D" },
{ key: "sxa79", text: "AdrenalineShot Stop Early OneShot3D" },
{ key: "sxa80", text: "AdrenalineShot Stop OneShot2D" },
{ key: "sxa81", text: "AdrenalineShot Stop OneShot3D" },
{ key: "sxa82", text: "ATMine Bounce Soft OneShot3D" },
{ key: "sxa83", text: "ATMine Equip OneShot2D" },
{ key: "sxa84", text: "ATMine Equip OneShot3D" },
{ key: "sxa85", text: "ATMine Pickup OneShot2D" },
{ key: "sxa86", text: "ATMine Pickup OneShot3D" },
{ key: "sxa87", text: "ATMine UnEquip OneShot2D" },
{ key: "sxa88", text: "ATMine UnEquip OneShot3D" },
{ key: "sxa89", text: "C4 Activate OneShot2D" },
{ key: "sxa90", text: "C4 Activate OneShot3D" },
{ key: "sxa91", text: "C4 Deploy OneShot2D" },
{ key: "sxa92", text: "C4 Deploy OneShot3D" },
{ key: "sxa93", text: "C4 Spawnable Pickup OneShot3D" },
{ key: "sxa94", text: "C4 Spawnable Spawn OneShot3D" },
{ key: "sxa95", text: "C4 Throw OneShot2D" },
{ key: "sxa96", text: "C4 Throw OneShot3D" },
{ key: "sxa97", text: "C4 Undeploy OneShot2D" },
{ key: "sxa98", text: "C4 Undeploy OneShot3D" },
{ key: "sxa99", text: "ConcussionGrenade ConcussionLoop SimpleLoop2D" },
{ key: "sxa100", text: "ConcussionGrenade ConcussionStart OneShot2D" },
{ key: "sxa101", text: "Decoy WeaponFireVar01 OneShot3D" },
{ key: "sxa102", text: "Decoy WeaponFireVar02 OneShot3D" },
{ key: "sxa103", text: "Decoy WeaponFireVar03 OneShot3D" },
{ key: "sxa104", text: "Decoy WeaponFireVar04 OneShot3D" },
{ key: "sxa105", text: "Decoy WeaponFireVar05 OneShot3D" },
{ key: "sxa106", text: "Defibrillator Equipped Charge OneShot2D" },
{ key: "sxa107", text: "Defibrillator Equipped Charge OneShot3D" },
{ key: "sxa108", text: "Defibrillator Equipped Charged OneShot2D" },
{ key: "sxa109", text: "Defibrillator Equipped Charged OneShot3D" },
{ key: "sxa110", text: "Defibrillator Equipped ChargeHum OneShot2D" },
{ key: "sxa111", text: "Defibrillator Equipped ChargeHum OneShot3D" },
{ key: "sxa112", text: "Defibrillator Equipped ChargeRub OneShot2D" },
{ key: "sxa113", text: "Defibrillator Equipped ChargeRub OneShot3D" },
{ key: "sxa114", text: "Defibrillator Equipped Deploy OneShot2D" },
{ key: "sxa115", text: "Defibrillator Equipped Deploy OneShot3D" },
{ key: "sxa116", text: "Defibrillator Equipped Fire Miss OneShot2D" },
{ key: "sxa117", text: "Defibrillator Equipped Fire Miss OneShot3D" },
{ key: "sxa118", text: "Defibrillator Equipped Fire OneShot2D" },
{ key: "sxa119", text: "Defibrillator Equipped Fire OneShot3D" },
{ key: "sxa120", text: "Defibrillator Equipped Revive Hit OneShot3D" },
{ key: "sxa121", text: "Defibrillator Equipped Undeploy OneShot2D" },
{ key: "sxa122", text: "Defibrillator Equipped Undeploy OneShot3D" },
{ key: "sxa123", text: "DeployableCover Damage OneShot3D" },
{ key: "sxa124", text: "DeployableCover Deploy OneShot2D" },
{ key: "sxa125", text: "DeployableCover Deploy OneShot3D" },
{ key: "sxa126", text: "DeployableCover Destruction OneShot3D" },
{ key: "sxa127", text: "DeployableCover Pickup OneShot3D" },
{ key: "sxa128", text: "DeployableCover Place OneShot3D" },
{ key: "sxa129", text: "DeployableCover Throw OneShot2D" },
{ key: "sxa130", text: "DeployableCover Throw OneShot3D" },
{ key: "sxa131", text: "DeployableCover Undeploy OneShot2D" },
{ key: "sxa132", text: "DeployableCover Undeploy OneShot3D" },
{ key: "sxa133", text: "Drone Spawnable Fire OneShot3D" },
{ key: "sxa134", text: "Drone Spawnable TargetLockInProgress OneShot2D" },
{ key: "sxa135", text: "Drone Spawnable TargetLockReady OneShot2D" },
{ key: "sxa136", text: "Drone Switchblade Engine Propellar OneShot3D" },
{ key: "sxa137", text: "Drone Switchblade HiFi Fire Wings OneShot2D" },
{ key: "sxa138", text: "Drone Switchblade HiFi Fire Wings OneShot3D" },
{ key: "sxa139", text: "EIDOS Disabled OneShot3D" },
{ key: "sxa140", text: "EIDOS Enable OneShot3D" },
{ key: "sxa141", text: "EIDOS Equip OneShot2D" },
{ key: "sxa142", text: "EIDOS Equip OneShot3D" },
{ key: "sxa143", text: "EIDOS Fire OneShot3D" },
{ key: "sxa144", text: "EIDOS Idle SimpleLoop3D" },
{ key: "sxa145", text: "EIDOS Pickup OneShot3D" },
{ key: "sxa146", text: "EIDOS Place OneShot2D" },
{ key: "sxa147", text: "EIDOS Place OneShot3D" },
{ key: "sxa148", text: "EoDBot Spawnable Arm Horizontal OneShot3D" },
{ key: "sxa149", text: "EoDBot Spawnable Arm Vertical OneShot3D" },
{ key: "sxa150", text: "EoDBot Spawnable Chassis Rattle OneShot3D" },
{ key: "sxa151", text: "EoDBot Spawnable Deploy OneShot2D" },
{ key: "sxa152", text: "EoDBot Spawnable Deploy OneShot3D" },
{ key: "sxa153", text: "EoDBot Spawnable Engine OneShot3D" },
{ key: "sxa154", text: "EoDBot Spawnable Idle OneShot3D" },
{ key: "sxa155", text: "EoDBot Spawnable MineFire OneShot3D" },
{ key: "sxa156", text: "EoDBot Spawnable Start Idle OneShot3D" },
{ key: "sxa157", text: "EoDBot Spawnable Stop Idle OneShot3D" },
{ key: "sxa158", text: "EpiPen Charge OneShot2D" },
{ key: "sxa159", text: "EpiPen Charge OneShot3D" },
{ key: "sxa160", text: "EpiPen Flip OneShot2D" },
{ key: "sxa161", text: "EpiPen Flip OneShot3D" },
{ key: "sxa162", text: "EpiPen HalfWay OneShot2D" },
{ key: "sxa163", text: "EpiPen HalfWay OneShot3D" },
{ key: "sxa164", text: "EpiPen Injection OneShot2D" },
{ key: "sxa165", text: "EpiPen Injection OneShot3D" },
{ key: "sxa166", text: "EpiPen ReviveDone 1p OneShot2D" },
{ key: "sxa167", text: "EpiPen Undeploy OneShot2D" },
{ key: "sxa168", text: "EpiPen Undeploy OneShot3D" },
{ key: "sxa169", text: "Flashbang FlashbangLoop OneShot2D" },
{ key: "sxa170", text: "Flashbang FlashbangStart OneShot2D" },
{ key: "sxa171", text: "SupplyDrop CrateExplode 3D" },
{ key: "sxa172", text: "BR Circle Appear OneShot2D" },
{ key: "sxa173", text: "BR Circle Boundary SimpleLoop2D" },
{ key: "sxa174", text: "BR Circle Damage OneShot2D" },
{ key: "sxa175", text: "BR Circle Damage OneShot3D" },
{ key: "sxa176", text: "BR Circle DamageStart Loop2D" },
{ key: "sxa177", text: "BR Circle DamageStart Loop3D" },
{ key: "sxa178", text: "BR Circle DamageStop Loop2D" },
{ key: "sxa179", text: "BR Circle DamageStop Loop3D" },
{ key: "sxa180", text: "BR Circle DeathWarning SimpleLoop2D" },
{ key: "sxa181", text: "BR Circle DeathWarning SimpleLoop3D" },
{ key: "sxa182", text: "BR Circle Debris OneShot3D" },
{ key: "sxa183", text: "BR Circle Fire Close SimpleLoop3D" },
{ key: "sxa184", text: "BR Circle Fire Distant High SimpleLoop3D" },
{ key: "sxa185", text: "BR Circle Fire Distant SimpleLoop3D" },
{ key: "sxa186", text: "BR Circle Fire Embers SimpleLoop3D" },
{ key: "sxa187", text: "BR Circle Fire High SimpleLoop3D" },
{ key: "sxa188", text: "BR Circle Fire Mid Distant SimpleLoop3D" },
{ key: "sxa189", text: "BR Circle Fire Perimeter SimpleLoop3D" },
{ key: "sxa190", text: "BR Circle Fire Phase SimpleLoop3D" },
{ key: "sxa191", text: "BR Circle Fire VeryHigh SimpleLoop3D" },
{ key: "sxa192", text: "BR Circle Fire Wide SimpleLoop3D" },
{ key: "sxa193", text: "BR Circle FlareUp OneShot3D" },
{ key: "sxa194", text: "BR Circle Wind OneShot3D" },
{ key: "sxa195", text: "BR MidroundRespawn RespawnTower Capture OneShot2D" },
{ key: "sxa196", text: "BR MidroundRespawn RespawnTower PanelReset OneShot2D" },
{ key: "sxa197", text: "BR MidroundRespawn RespawnTower Stow OneShot2D" },
{ key: "sxa198", text: "BR Mission CTF DataDrive Insert OneShot3D" },
{ key: "sxa199", text: "BR Mission CTF Download OneShot3D" },
{ key: "sxa200", text: "BR Mission CTF DriveCarrierTracking OneShot3D" },
{ key: "sxa201", text: "BR Mission DataExtraction DataCase PickUp OneShot3D" },
{ key: "sxa202", text: "BR Mission DemoCrew Alarm Close SimpleLoop3D" },
{ key: "sxa203", text: "BR Mission DemoCrew Alarm Distant SimpleLoop3D" },
{ key: "sxa204", text: "BR Mission DemoCrew BombPickUp OneShot3D" },
{ key: "sxa205", text: "BR Mission DemoCrew BombPlace OneShot3D" },
{ key: "sxa206", text: "BR Mission DemoCrewAlarmClose SimpleLoop 3D" },
{ key: "sxa207", text: "BR Mission RetrievalBeaconBeep OneShot3D" },
{ key: "sxa208", text: "BR Mission WeaponCache BoltCutter Pickup OneShot3D" },
{ key: "sxa209", text: "BR Mission WeaponCache Open OneShot3D" },
{ key: "sxa210", text: "BR Mission Wreckage BombBeeping Loop SimpleLoop3D" },
{ key: "sxa211", text: "BR Mission Wreckage BombBeeping OneShot3D" },
{ key: "sxa212", text: "BR Mission Wreckage ComputerAlarm SimpleLoop3D" },
{ key: "sxa213", text: "BR RespawnTower Activate Alarm SimpleLoop3D" },
{ key: "sxa214", text: "BR RespawnTower Activate Close OneShot3D" },
{ key: "sxa215", text: "BR RespawnTower Activate Distant SimpleLoop3D" },
{ key: "sxa216", text: "BR UXUI CircleShrink Start OneShot2D" },
{ key: "sxa217", text: "BR UXUI CIrcleShrink Stop OneShot2D" },
{ key: "sxa218", text: "Gauntlet Mission Beacons Beeping SimpleLoop3D" },
{ key: "sxa219", text: "Gauntlet Mission Circuit TerminalSpotLoop SimpleLoop3D" },
{ key: "sxa220", text: "Gauntlet Mission Heist AltCacheCarrierBeep SimpleLoop3D" },
{ key: "sxa221", text: "Gauntlet Mission Heist CacheBeep SimpleLoop3D" },
{ key: "sxa222", text: "Gauntlet Mission Heist PlayerPickupCache OneShot3D" },
{ key: "sxa223", text: "Gauntlet Mission Wreckage ActiveBombNearby OneShot3D" },
{ key: "sxa224", text: "Gauntlet Mission Wreckage BombPickup3D OneShot3D" },
{ key: "sxa225", text: "Gauntlet Mission Wreckage KeyboardTyping SimpleLoop3D" },
{ key: "sxa226", text: "Payload Breacher Decel OneShot3D" },
{ key: "sxa227", text: "Payload Breacher Exterior Accel SimpleLoop3D" },
{ key: "sxa228", text: "Payload Breacher Idle SimpleLoop3D" },
{ key: "sxa229", text: "Payload Breacher Tracks SimpleLoop3D" },
{ key: "sxa230", text: "Rush Alarm Leadout SimpleLoop3D" },
{ key: "sxa231", text: "Rush Alarm SimpleLoop3D" },
{ key: "sxa232", text: "Rush Arm SimpleLoop3D" },
{ key: "sxa233", text: "Rush Armed OneShot3D" },
{ key: "sxa234", text: "Rush Defused OneShot3D" },
{ key: "sxa235", text: "Rush Defusing SimpleLoop3D" },
{ key: "sxa236", text: "Rush Telemetry SimpleLoop3D" },
{ key: "sxa237", text: "Brooklyn Shared BigWorld Birds Falcons OneShot3D" },
{ key: "sxa238", text: "Brooklyn Shared BigWorld Birds Finches OneShot3D" },
{ key: "sxa239", text: "Brooklyn Shared BigWorld Birds Grebs OneShot3D" },
{ key: "sxa240", text: "Brooklyn Shared BigWorld Birds Pigeons OneShot3D" },
{ key: "sxa241", text: "Brooklyn Shared BigWorld Birds Swallows OneShot3D" },
{ key: "sxa242", text: "Brooklyn Shared BigWorld BuildingGroan OneShot3D" },
{ key: "sxa243", text: "Brooklyn Shared BigWorld CarHorn Angry OneShot3D" },
{ key: "sxa244", text: "Brooklyn Shared BigWorld EmergSirensMisc Far OneShot3D" },
{ key: "sxa245", text: "Brooklyn Shared BigWorld EmergSirensMisc Near OneShot3D" },
{ key: "sxa246", text: "Brooklyn Shared BigWorld InteriorWoodCreak OneShot3D" },
{ key: "sxa247", text: "Brooklyn Shared BigWorld MouseSqueak Urban OneShot3D" },
{ key: "sxa248", text: "Brooklyn Shared BigWorld WoodDoorOpen Distant OneShot3D" },
{ key: "sxa249", text: "Brooklyn Shared BigWorld WoodDoorShut Distant OneShot3D" },
{ key: "sxa250", text: "Brooklyn Shared Spots AirDuct SimpleLoop3D" },
{ key: "sxa251", text: "Brooklyn Shared Spots CarAlarm SimpleLoop3D" },
{ key: "sxa252", text: "Brooklyn Shared Spots Fountain Water Head SimpleLoop3D" },
{ key: "sxa253", text: "Brooklyn Shared Spots Fountain Water SimpleLoop3D" },
{ key: "sxa254", text: "Brooklyn Shared Spots GarbageFlies SimpleLoop3D" },
{ key: "sxa255", text: "Brooklyn Shared Spots HeavyMetalStress SimpleLoop3D" },
{ key: "sxa256", text: "Brooklyn Shared Spots Hydrant Burst OneShot3D" },
{ key: "sxa257", text: "Brooklyn Shared Spots Hydrant Ground SimpleLoop3D" },
{ key: "sxa258", text: "Brooklyn Shared Spots Hydrant Splatter SimpleLoop3D" },
{ key: "sxa259", text: "Brooklyn Shared Spots Hydrant Spray SimpleLoop3D" },
{ key: "sxa260", text: "Brooklyn Shared Spots MetalStress OneShot3D" },
{ key: "sxa261", text: "Brooklyn Shared Spots MiceFighting SimpleLoop3D" },
{ key: "sxa262", text: "Brooklyn Shared Spots PaperSwirls SimpleLoop3D" },
{ key: "sxa263", text: "Brooklyn Shared Spots PipeStress SimpleLoop3D" },
{ key: "sxa264", text: "Brooklyn Shared Spots VariousBirds SimpleLoop3D" },
{ key: "sxa265", text: "Brooklyn Shared Spots Water Splash SimpleLoop3D" },
{ key: "sxa266", text: "Brooklyn Shared Spots WaterTrickle Stone SimpleLoop3D" },
{ key: "sxa267", text: "Brooklyn Shared Spots WaterTrickle Wood SimpleLoop3D" },
{ key: "sxa268", text: "Brooklyn Shared Spots WindChime SimpleLoop3D" },
{ key: "sxa269", text: "Brooklyn SP Attack FX SteamManhole SimpleLoop3D" },
{ key: "sxa270", text: "Brooklyn Spots ACUnit SimpleLoop3D" },
{ key: "sxa271", text: "Brooklyn Spots BridgeFire L SimpleLoop3D" },
{ key: "sxa272", text: "Brooklyn Spots BridgeMovement SimpleLoop3D" },
{ key: "sxa273", text: "Brooklyn Spots BridgeOverpass SimpleLoop3D" },
{ key: "sxa274", text: "Brooklyn Spots FireAlarm SimpleLoop3D" },
{ key: "sxa275", text: "Brooklyn Spots FoodTrailer SimpleLoop3D" },
{ key: "sxa276", text: "Brooklyn Spots Fridge SimpleLoop3D" },
{ key: "sxa277", text: "Brooklyn Spots GarbageCluster SimpleLoop3D" },
{ key: "sxa278", text: "Brooklyn Spots MonitorStatic SimpleLoop3D" },
{ key: "sxa279", text: "Brooklyn Spots PoliceChatter OneShot OneShot3D" },
{ key: "sxa280", text: "Brooklyn Spots PoliceChatter SimpleLoop3D" },
{ key: "sxa281", text: "Brooklyn Spots RadioChatter OneShot3D" },
{ key: "sxa282", text: "Brooklyn Spots Riverside Calm SimpleLoop3D" },
{ key: "sxa283", text: "Brooklyn Spots Riverside SimpleLoop3D" },
{ key: "sxa284", text: "Brooklyn Spots SaxophoneInWall OneShot3D" },
{ key: "sxa285", text: "Brooklyn Spots SmallRadio SimpleLoop3D" },
{ key: "sxa286", text: "Brooklyn Spots Vista Riverside SimpleLoop3D" },
{ key: "sxa287", text: "Brooklyn Spots WelcomeSign SimpleLoop3D" },
{ key: "sxa288", text: "Cairo MP Abbasid BigWorld TheklaLarkSong OneShot2D" },
{ key: "sxa289", text: "Cairo MP Abbasid Spots Birds Palace SimpleLoop3D" },
{ key: "sxa290", text: "Cairo MP Abbasid Spots BusWreck OneShot3D" },
{ key: "sxa291", text: "Cairo MP Abbasid Spots Firealarm SimpleLoop3D" },
{ key: "sxa292", text: "Cairo MP Abbasid Spots Fountain SimpleLoop3D" },
{ key: "sxa293", text: "Cairo MP Abbasid Spots HangingLamp OneShot3D" },
{ key: "sxa294", text: "Cairo MP Abbasid Spots HighwayTraffic SimpleLoop3D" },
{ key: "sxa295", text: "Cairo MP Abbasid Spots HighwayWreckFire SimpleLoop3D" },
{ key: "sxa296", text: "Cairo MP Abbasid Spots Intercom SimpleLoop3D" },
{ key: "sxa297", text: "Cairo MP Abbasid Spots RatsInVent SimpleLoop3D" },
{ key: "sxa298", text: "Cairo MP Abbasid Spots Waterpipe SimpleLoop3D" },
{ key: "sxa299", text: "Cairo MP Outskirts Spots ExcavatorEngine SimpleLoop3D" },
{ key: "sxa300", text: "Cairo MP Outskirts Spots PigeonTowerCreak SimpleLoop3D" },
{ key: "sxa301", text: "Cairo MP Outskirts Spots RatsEating SimpleLoop3D" },
{ key: "sxa302", text: "Cairo MP Outskirts Spots TrashPile SimpleLoop3D" },
{ key: "sxa303", text: "Cairo MP Outskirts Spots Wind ClothFlaps SimpleLoop3D" },
{ key: "sxa304", text: "Cairo MP Outskirts Spots Wind DesertWindGusts SimpleLoop3D" },
{ key: "sxa305", text: "Cairo MP Outskirts Spots Wind HeavyGusts SimpleLoop3D" },
{ key: "sxa306", text: "Cairo MP Outskirts Spots Wind HowlingHollow High SimpleLoop3D" },
{ key: "sxa307", text: "Cairo MP Outskirts Spots Wind HowlingWarm SimpleLoop3D" },
{ key: "sxa308", text: "Cairo MP Outskirts Spots Wind MetalWindGusts SimpleLoop3D" },
{ key: "sxa309", text: "Cairo MP Outskirts Spots Wind RoadWind SimpleLoop3D" },
{ key: "sxa310", text: "Cairo MP Outskirts Spots Wind Whistling SimpleLoop3D" },
{ key: "sxa311", text: "Cairo MP Shared Bigworld AmbWar Weapons OneShot3D" },
{ key: "sxa312", text: "Cairo MP Shared Bigworld Animals EgyptianGoose OneShot3D" },
{ key: "sxa313", text: "Cairo MP Shared Bigworld Traffic Carhorn OneShot3D" },
{ key: "sxa314", text: "Cairo MP Shared Bigworld Winds CItySandMist SimpleLoop3D" },
{ key: "sxa315", text: "Cairo MP Shared Bigworld Winds SandMist SimpleLoop3D" },
{ key: "sxa316", text: "Cairo Shared BigWorld SirenBy OneShot3D" },
{ key: "sxa317", text: "Cairo Shared Spots Banner SimpleLoop3D" },
{ key: "sxa318", text: "Cairo Shared Spots BirdsAlley OneShot3D" },
{ key: "sxa319", text: "Cairo Shared Spots CommonMynah OneShot3D" },
{ key: "sxa320", text: "Cairo Shared Spots DistantChants OneShot3D" },
{ key: "sxa321", text: "Cairo Shared Spots Highway SimpleLoop3D" },
{ key: "sxa322", text: "Cairo Shared Spots Insects OneShot3D" },
{ key: "sxa323", text: "Cairo Shared Spots Locusts OneShot3D" },
{ key: "sxa324", text: "Cairo Shared Spots OliveTree Crickets SimpleLoop3D" },
{ key: "sxa325", text: "Cairo Shared Spots VehicleStress SimpleLoop3D" },
{ key: "sxa326", text: "Cairo SP NightRaid BigWorld AluminiumCanDrop OneShot3D" },
{ key: "sxa327", text: "Cairo SP NightRaid BigWorld BullhornSiren OneShot3D" },
{ key: "sxa328", text: "Cairo SP NightRaid BigWorld Glass BottleDrop OneShot3D" },
{ key: "sxa329", text: "Cairo SP NightRaid BigWorld Glass WindowSmash OneShot3D" },
{ key: "sxa330", text: "Cairo SP NightRaid BigWorld Object ClotheslineRustle OneShot3D" },
{ key: "sxa331", text: "Cairo SP NightRaid BigWorld Object RugFlap OneShot3D" },
{ key: "sxa332", text: "Cairo SP NightRaid Spots Fire FireDrippingLow OneShot3D" },
{ key: "sxa333", text: "Cairo SP NightRaid Spots Fire Flare SimpleLoop3D" },
{ key: "sxa334", text: "Cairo SP NightRaid Spots Fire FlareShot OneShot3D" },
{ key: "sxa335", text: "Cairo SP NightRaid Spots Fire FlareShotExplode OneShot3D" },
{ key: "sxa336", text: "Cairo SP NightRaid Spots Fire IvyXS SimpleLoop3D" },
{ key: "sxa337", text: "Cairo SP NightRaid Spots Fire PalaceFabric SimpleLoop3D" },
{ key: "sxa338", text: "Cairo SP NightRaid Spots Fire PalaceFurniture SimpleLoop3D" },
{ key: "sxa339", text: "Cairo SP NightRaid Spots Fire PalaceSmall SimpleLoop3D" },
{ key: "sxa340", text: "Cairo SP NightRaid Spots Fire PalaceSmoke SimpleLoop3D" },
{ key: "sxa341", text: "Cairo SP NightRaid Spots Fire PalaceTiny SimpleLoop3D" },
{ key: "sxa342", text: "Cairo SP NightRaid Spots Fire PalaceVegetation SimpleLoop3D" },
{ key: "sxa343", text: "Cairo SP NightRaid Spots Fire ProjectileMolotovLand OneShot3D" },
{ key: "sxa344", text: "Cairo SP NightRaid Spots Fire ProjectileMolotovThrow OneShot3D" },
{ key: "sxa345", text: "Cairo SP NightRaid Spots Fire RiotMolotovLand OneShot3D" },
{ key: "sxa346", text: "Cairo SP NightRaid Spots Fire SparksGround SimpleLoop3D" },
{ key: "sxa347", text: "Cairo SP NightRaid Spots HelicopterWind SimpleLoop3D" },
{ key: "sxa348", text: "Cairo SP NightRaid Spots HighwayUnderneath SimpleLoop3D" },
{ key: "sxa349", text: "Cairo SP NightRaid Spots LightbulbMoths SimpleLoop3D" },
{ key: "sxa350", text: "Cairo SP NightRaid Spots Molotov OneShot3D" },
{ key: "sxa351", text: "Cairo SP NightRaid Spots MotorScooterIdle SimpleLoop3D" },
{ key: "sxa352", text: "Cairo SP NightRaid Spots PalaceFireAlarm SimpleLoop3D" },
{ key: "sxa353", text: "Cairo SP NightRaid Spots Riot Activity SimpleLoop3D" },
{ key: "sxa354", text: "Cairo SP NightRaid Spots Riot CrowdRumble SimpleLoop3D" },
{ key: "sxa355", text: "Cairo SP NightRaid Spots Riot FenceShake SimpleLoop3D" },
{ key: "sxa356", text: "Cairo SP NightRaid Spots Riot MetalDestruction SimpleLoop3D" },
{ key: "sxa357", text: "Cairo SP NightRaid Spots Riot TearGas SimpleLoop3D" },
{ key: "sxa358", text: "Cairo SP NightRaid Spots RockHit OneShot3D" },
{ key: "sxa359", text: "Cairo SP NightRaid Spots RopeStress OneShot3D" },
{ key: "sxa360", text: "Cairo SP NightRaid Spots ScaffoldingTarp SimpleLoop3D" },
{ key: "sxa361", text: "Cairo SP NightRaid Spots Sewers WaterDrippingLarge SimpleLoop3D" },
{ key: "sxa362", text: "Cairo SP NightRaid Spots Sewers WaterDrippingMedium SimpleLoop3D" },
{ key: "sxa363", text: "Cairo SP NightRaid Spots Sewers WaterDrippingSmall SimpleLoop3D" },
{ key: "sxa364", text: "Cairo SP NightRaid Spots Sewers WaterDrips SimpleLoop3D" },
{ key: "sxa365", text: "Cairo SP NightRaid Spots Sewers WaterSquirt SimpleLoop3D" },
{ key: "sxa366", text: "Cairo SP NightRaid Spots SwingSet SimpleLoop3D" },
{ key: "sxa367", text: "Cairo SP NightRaid Spots Walla Riot SimpleLoop3D" },
{ key: "sxa368", text: "Cairo SP NightRaid Spots Walla RiotBullhorn OneShot3D" },
{ key: "sxa369", text: "Cairo SP NightRaid Spots Walla RiotCrowd SimpleLoop3D" },
{ key: "sxa370", text: "Cairo SP NightRaid Spots Walla RiotCrowdCheer SimpleLoop3D" },
{ key: "sxa371", text: "Cairo SP NightRaid Spots WashingMachine SimpleLoop3D" },
{ key: "sxa372", text: "Cairo SP NightRaid Spots Whistle OneShot3D" },
{ key: "sxa373", text: "Flybys Bullet Crack DMR Distant OneShot3D" },
{ key: "sxa374", text: "Flybys Bullet Crack Intermediate Close Indoor OneShot3D" },
{ key: "sxa375", text: "Flybys Bullet Crack Intermediate Close OneShot3D" },
{ key: "sxa376", text: "Flybys Bullet Crack Intermediate Distant OneShot3D" },
{ key: "sxa377", text: "Flybys Bullet Crack Rifle Close OneShot3D" },
{ key: "sxa378", text: "Flybys Bullet Crack Rifle Distant OneShot3D" },
{ key: "sxa379", text: "Flybys Bullet Crack Sniper Close OneShot3D" },
{ key: "sxa380", text: "Flybys Bullet Crack Sniper Distant OneShot3D" },
{ key: "sxa381", text: "Flybys Bullet Whizby Intermediate Main Distant OneShot3D" },
{ key: "sxa382", text: "Flybys Bullet Whizby Intermediate Main OneShot3D" },
{ key: "sxa383", text: "Flybys Bullet Whizby Intermediate Main Underwater OneShot3D" },
{ key: "sxa384", text: "Flybys Bullet Whizby Intermediate Sweetener Buckshot OneShot3D" },
{ key: "sxa385", text: "Flybys Bullet Whizby Intermediate Sweetener OneShot3D" },
{ key: "sxa386", text: "Flybys Bullet Whizby Sniper Main OneShot3D" },
{ key: "sxa387", text: "Flybys Large AutoCannon 40mm FlyBy OneShot3D" },
{ key: "sxa388", text: "Flybys Large Cannon Shell 120mm Distant SimpleLoop3D" },
{ key: "sxa389", text: "Flybys Large Cannon Shell 120mm FlyBy Close OneShot3D" },
{ key: "sxa390", text: "Flybys Large Cannon Shell 120mm FlyBy Distant OneShot3D" },
{ key: "sxa391", text: "Flybys Large Rocket Missile FlyBy OneShot3D" },
{ key: "sxa392", text: "Flybys Large Rocket Missile Ignite OneShot3D" },
{ key: "sxa393", text: "Flybys Large Rocket Missile Trail SimpleLoop3D" },
{ key: "sxa394", text: "Flybys Large Rocket RocketPod Trail Distant SimpleLoop3D" },
{ key: "sxa395", text: "Flybys Large Rocket RPG FlyBy Distant OneShot3D" },
{ key: "sxa396", text: "Flybys Shared Projectile Flyby OneShot3D" },
{ key: "sxa397", text: "Flybys Shared Projectile MissileTrail SimpleLoop3D" },
{ key: "sxa398", text: "Flybys Shared RocketStart OneShot3D" },
{ key: "sxa399", text: "Flybys Shared SmallAntiTank SimpleLoop3D" },
{ key: "sxa400", text: "Flybys Shared SmallAntiTank Starter OneShot3D" },
{ key: "sxa401", text: "FlyBys Large GrenadeLauncher 40mm Close SimpleLoop3D" },
{ key: "sxa402", text: "FlyBys Large GrenadeLauncher 40mm OneShot3D" },
{ key: "sxa403", text: "FlyBys Shells Artillery Incoming OneShot3D" },
{ key: "sxa404", text: "Damage ArmorBreakSelf OneShot2D" },
{ key: "sxa405", text: "Damage ArmorDamage Enemy OneShot2D" },
{ key: "sxa406", text: "Damage ArmorDamage Hard Self OneShot2D" },
{ key: "sxa407", text: "Damage ArmorDamage Soft Self OneShot2D" },
{ key: "sxa408", text: "Damage BarbedWire Death OneShot2D" },
{ key: "sxa409", text: "Damage BarbedWire OneShot2D" },
{ key: "sxa410", text: "Damage Bullet Death NoRevive OneShot2D" },
{ key: "sxa411", text: "Damage Bullet Headshot OneShot2D" },
{ key: "sxa412", text: "Damage Bullet HeadshotAdd OneShot2D" },
{ key: "sxa413", text: "Damage Bullet OneShot2D" },
{ key: "sxa414", text: "Damage BulletThump OneShot2D" },
{ key: "sxa415", text: "Damage Defibs Death OneShot2D" },
{ key: "sxa416", text: "Damage Defibs OneShot2D" },
{ key: "sxa417", text: "Damage Destruction Death OneShot2D" },
{ key: "sxa418", text: "Damage Destruction OneShot2D" },
{ key: "sxa419", text: "Damage Drowning OneShot2D" },
{ key: "sxa420", text: "Damage Explosion Crack OneShot2D" },
{ key: "sxa421", text: "Damage Explosion Death OneShot2D" },
{ key: "sxa422", text: "Damage Explosion Ring SimpleLoop2D" },
{ key: "sxa423", text: "Damage ExplosionDebris OneShot2D" },
{ key: "sxa424", text: "Damage Fall Death OneShot2D" },
{ key: "sxa425", text: "Damage Fall Low OneShot2D" },
{ key: "sxa426", text: "Damage Fall Medium OneShot2D" },
{ key: "sxa427", text: "Damage Fire Death OneShot2D" },
{ key: "sxa428", text: "Damage Fire Normal SimpleLoop2D" },
{ key: "sxa429", text: "Damage Fire Small SimpleLoop2D" },
{ key: "sxa430", text: "Damage Fire Start OneShot2D" },
{ key: "sxa431", text: "Damage Melee Death OneShot2D" },
{ key: "sxa432", text: "Damage MeleeBlunt OneShot2D" },
{ key: "sxa433", text: "Damage MeleeKnife Death OneShot2D" },
{ key: "sxa434", text: "Damage MeleeKnife OneShot2D" },
{ key: "sxa435", text: "Damage Ring Death OneShot2D" },
{ key: "sxa436", text: "Damage Ring Normal OneShot2D" },
{ key: "sxa437", text: "Damage Ring Start OneShot2D" },
{ key: "sxa438", text: "Damage Sabotage Death OneShot2D" },
{ key: "sxa439", text: "Damage Sabotage OneShot2D" },
{ key: "sxa440", text: "Damage Throwable OneShot2D" },
{ key: "sxa441", text: "Damage ThrowingKnife OneShot2D" },
{ key: "sxa442", text: "Events Damage BreathFemale SimpleLoop2D" },
{ key: "sxa443", text: "Events Damage BreathMale SimpleLoop2D" },
{ key: "sxa444", text: "Events SoldierDown BreathFemale OneShot2D" },
{ key: "sxa445", text: "Events SoldierDown BreathFemale SimpleLoop2D" },
{ key: "sxa446", text: "Events SoldierDown BreathMale OneShot2D" },
{ key: "sxa447", text: "Events SoldierDown BreathMale SimpleLoop2D" },
{ key: "sxa448", text: "Events SoldierDown DeathSigh OneShot2D" },
{ key: "sxa449", text: "Events SoldierDown DeathStinger OneShot2D" },
{ key: "sxa450", text: "Events SoldierDown DeathStingerSkipRevive OneShot2D" },
{ key: "sxa451", text: "Events SoldierDown Drone BleedOut SimpleLoop2D" },
{ key: "sxa452", text: "Events SoldierDown Drone HighIntensity SimpleLoop2D" },
{ key: "sxa453", text: "Events SoldierDown Enter OneShot2D" },
{ key: "sxa454", text: "Events SoldierDown EnterNoDeployScreen OneShot2D" },
{ key: "sxa455", text: "Events SoldierDown Foley FoleyOnGroundStart OneShot2D" },
{ key: "sxa456", text: "Events SoldierDown Foley MovementLoop SimpleLoop2D" },
{ key: "sxa457", text: "Events SoldierDown Foley OnGround OneShot2D" },
{ key: "sxa458", text: "Events SoldierDown Foley SkipReviveStart OneShot2D" },
{ key: "sxa459", text: "Events SoldierDown Foley SkipReviveStop OneShot2D" },
{ key: "sxa460", text: "Events SoldierDown GeneralDrone SimpleLoop2D" },
{ key: "sxa461", text: "Events SoldierDown HeartBeat EKG OneShot2D" },
{ key: "sxa462", text: "Events SoldierDown HeartBeat OneShot2D" },
{ key: "sxa463", text: "Events SoldierDown LandOnGround EffortFemale OneShot2D" },
{ key: "sxa464", text: "Events SoldierDown LandOnGround EffortMale OneShot2D" },
{ key: "sxa465", text: "Events SoldierDown LowHealth Drone SimpleLoop2D" },
{ key: "sxa466", text: "Events SoldierDown LowHealth Enter OneShot2D" },
{ key: "sxa467", text: "Events SoldierDown ReviveSickness Drone SimpleLoop2D" },
{ key: "sxa468", text: "Events SoldierDown Skip SimpleLoop2D" },
{ key: "sxa469", text: "Events SoldierDown Skip Start OneShot2D" },
{ key: "sxa470", text: "FieldUpgrade Engineer Repairtool Start OneShot3D" },
{ key: "sxa471", text: "FieldUpgrade Engineer Repairtool Stop OneShot3D" },
{ key: "sxa472", text: "FieldUpgrade Support ActiveMedic Start OneShot3D" },
{ key: "sxa473", text: "FieldUpgrade Support ActiveMedic Stop OneShot3D" },
{ key: "sxa474", text: "Health FullHealth OneShot2D" },
{ key: "sxa475", text: "Health Start Regenerate OneShot2D" },
{ key: "sxa476", text: "Interact KeycardPickup OneShot3D" },
{ key: "sxa477", text: "Interact Pickup OneShot3D" },
{ key: "sxa478", text: "Interact UpgradeKitPickup OneShot3D" },
{ key: "sxa479", text: "Interact WeaponPickup OneShot3D" },
{ key: "sxa480", text: "Melee AttackFoley OneShot2D" },
{ key: "sxa481", text: "Melee AttackFoley OneShot3D" },
{ key: "sxa482", text: "Melee Hit OneShot2D" },
{ key: "sxa483", text: "Melee Hit OneShot3D" },
{ key: "sxa484", text: "Melee Takedown Attacker ArmFoley Stab OneShot2D" },
{ key: "sxa485", text: "Melee Takedown Attacker ArmFoley Stab OneShot3D" },
{ key: "sxa486", text: "Melee Takedown Attacker CollectDogtag OneShot2D" },
{ key: "sxa487", text: "Melee Takedown Attacker CollectDogtag OneShot3D" },
{ key: "sxa488", text: "Melee Takedown Attacker EndKnife OneShot2D" },
{ key: "sxa489", text: "Melee Takedown Attacker EndKnife OneShot3D" },
{ key: "sxa490", text: "Melee Takedown Attacker Equip Knife OneShot2D" },
{ key: "sxa491", text: "Melee Takedown Attacker Equip Knife OneShot3D" },
{ key: "sxa492", text: "Melee Takedown Attacker Equip Sledgehammer OneShot2D" },
{ key: "sxa493", text: "Melee Takedown Attacker Equip Sledgehammer OneShot3D" },
{ key: "sxa494", text: "Melee Takedown Attacker Female OneShot2D" },
{ key: "sxa495", text: "Melee Takedown Attacker Female OneShot3D" },
{ key: "sxa496", text: "Melee Takedown Attacker GrabShoulder OneShot2D" },
{ key: "sxa497", text: "Melee Takedown Attacker GrabShoulder OneShot3D" },
{ key: "sxa498", text: "Melee Takedown Attacker KnifePullOutFrontBody Fast OneShot2D" },
{ key: "sxa499", text: "Melee Takedown Attacker KnifePullOutFrontBody Fast OneShot3D" },
{ key: "sxa500", text: "Melee Takedown Attacker KnifeStabFrontBody Fast OneShot2D" },
{ key: "sxa501", text: "Melee Takedown Attacker KnifeStabFrontBody Fast OneShot3D" },
{ key: "sxa502", text: "Melee Takedown Attacker Male OneShot2D" },
{ key: "sxa503", text: "Melee Takedown Attacker Male OneShot3D" },
{ key: "sxa504", text: "Melee Takedown Attacker SledgehammerHit OneShot2D" },
{ key: "sxa505", text: "Melee Takedown Attacker SledgehammerHit OneShot3D" },
{ key: "sxa506", text: "Melee Takedown Attacker SledgehammerSwing OneShot2D" },
{ key: "sxa507", text: "Melee Takedown Attacker SledgehammerSwing OneShot3D" },
{ key: "sxa508", text: "Melee Takedown Attacker StartKnifeGrabShoulder OneShot2D" },
{ key: "sxa509", text: "Melee Takedown Attacker StartKnifeGrabShoulder OneShot3D" },
{ key: "sxa510", text: "Melee Takedown Attacker StartSledgehammerGrabShoulder OneShot2D" },
{ key: "sxa511", text: "Melee Takedown Attacker StartSledgehammerGrabShoulder OneShot3D" },
{ key: "sxa512", text: "Melee Takedown HurtHigh Female OneShot2D" },
{ key: "sxa513", text: "Melee Takedown HurtHigh Female OneShot3D" },
{ key: "sxa514", text: "Melee Takedown HurtHigh Male OneShot2D" },
{ key: "sxa515", text: "Melee Takedown HurtHigh Male OneShot3D" },
{ key: "sxa516", text: "Melee Takedown PanicScream Female OneShot2D" },
{ key: "sxa517", text: "Melee Takedown PanicScream Female OneShot3D" },
{ key: "sxa518", text: "Melee Takedown PanicScream Male OneShot2D" },
{ key: "sxa519", text: "Melee Takedown PanicScream Male OneShot3D" },
{ key: "sxa520", text: "Melee Takedown Struggle Female OneShot2D" },
{ key: "sxa521", text: "Melee Takedown Struggle Female OneShot3D" },
{ key: "sxa522", text: "Melee Takedown Struggle Male OneShot2D" },
{ key: "sxa523", text: "Melee Takedown Struggle Male OneShot3D" },
{ key: "sxa524", text: "Melee Takedown ThroatSlice Female OneShot2D" },
{ key: "sxa525", text: "Melee Takedown ThroatSlice Female OneShot3D" },
{ key: "sxa526", text: "Melee Takedown ThroatSlice Male OneShot2D" },
{ key: "sxa527", text: "Melee Takedown ThroatSlice Male OneShot3D" },
{ key: "sxa528", text: "Melee Takedown Victim FallToGround OneShot2D" },
{ key: "sxa529", text: "Melee Takedown Victim FallToGround OneShot3D" },
{ key: "sxa530", text: "Melee Takedown Victim TurnAround SlowShort OneShot2D" },
{ key: "sxa531", text: "Melee Takedown Victim TurnAround SlowShort OneShot3D" },
{ key: "sxa532", text: "Melee WorldHit OneShot2D" },
{ key: "sxa533", text: "Melee WorldHit OneShot3D" },
{ key: "sxa534", text: "Movement CameraNoise OneShot2D" },
{ key: "sxa535", text: "Movement Drag Grab OneShot3D" },
{ key: "sxa536", text: "Movement Drag Release OneShot2D" },
{ key: "sxa537", text: "Movement Drag Release OneShot3D" },
{ key: "sxa538", text: "Movement Efforts Breathing Soldier SimpleLoop2D" },
{ key: "sxa539", text: "Movement Efforts Breathing Soldier SimpleLoop3D" },
{ key: "sxa540", text: "Movement Efforts Breathing SoldierFemale SimpleLoop2D" },
{ key: "sxa541", text: "Movement Efforts Breathing SoldierFemale SimpleLoop3D" },
{ key: "sxa542", text: "Movement Efforts Breathing SoldierMale LoopStop Loop2D" },
{ key: "sxa543", text: "Movement Efforts Breathing SoldierMale LoopStop Loop3D" },
{ key: "sxa544", text: "Movement Efforts Breathing SoldierMale SimpleLoop2D" },
{ key: "sxa545", text: "Movement Efforts Breathing SoldierMale SimpleLoop3D" },
{ key: "sxa546", text: "Movement Efforts CockpitEject OneShot3D" },
{ key: "sxa547", text: "Movement Efforts Crouch Female OneShot2D" },
{ key: "sxa548", text: "Movement Efforts Crouch Female OneShot3D" },
{ key: "sxa549", text: "Movement Efforts Crouch Male OneShot2D" },
{ key: "sxa550", text: "Movement Efforts Crouch Male OneShot3D" },
{ key: "sxa551", text: "Movement Foley ProneMovement OneShot3D" },
{ key: "sxa552", text: "Movement Foley WeaponAdd AR Mount OneShot3D" },
{ key: "sxa553", text: "Movement Foley WeaponAdd LMGMag Mount OneShot3D" },
{ key: "sxa554", text: "Movement Foley WeaponAdd Shotgun Mount OneShot3D" },
{ key: "sxa555", text: "Movement Foley WeaponAdd SMG Mount OneShot3D" },
{ key: "sxa556", text: "Movement Foley WeaponAdd Sniper Mount OneShot3D" },
{ key: "sxa557", text: "Movement Slide FoleyEnd OneShot3D" },
{ key: "sxa558", text: "Movement Slide FoleyStart OneShot3D" },
{ key: "sxa559", text: "Movement Water Splash OneShot3D" },
{ key: "sxa560", text: "Movement Water Swim ArmStroke OneShot3D" },
{ key: "sxa561", text: "Movement Water Swim FootStroke Surface SimpleLoop2D" },
{ key: "sxa562", text: "Movement Water Swim FootStroke Surface SimpleLoop3D" },
{ key: "sxa563", text: "Movement Water Swim FootStroke Underwater SimpleLoop2D" },
{ key: "sxa564", text: "Movement Water Swim FootStroke Underwater SimpleLoop3D" },
{ key: "sxa565", text: "Movement Water Wade Sprint SimpleLoop3D" },
{ key: "sxa566", text: "Movement Water Wade Walk SimpleLoop3D" },
{ key: "sxa567", text: "Movement Wind SimpleLoop3D" },
{ key: "sxa568", text: "Parachute Cut OneShot3D" },
{ key: "sxa569", text: "Parachute Deploy Effort Female OneShot2D" },
{ key: "sxa570", text: "Parachute Deploy Effort Female OneShot3D" },
{ key: "sxa571", text: "Parachute Deploy Effort Male OneShot2D" },
{ key: "sxa572", text: "Parachute Deploy Effort Male OneShot3D" },
{ key: "sxa573", text: "Parachute Deploy OneShot3D" },
{ key: "sxa574", text: "Parachute Glide SimpleLoop3D" },
{ key: "sxa575", text: "Parachute Land OneShot3D" },
{ key: "sxa576", text: "Parachute Rain SimpleLoop3D" },
{ key: "sxa577", text: "Parachute ToggleGrab OneShot3D" },
{ key: "sxa578", text: "Parachute TogglePull OneShot3D" },
{ key: "sxa579", text: "Parachute ToggleRelease OneShot3D" },
{ key: "sxa580", text: "Ragdoll OnDeath OneShot3D" },
{ key: "sxa581", text: "Revive BeingRevived OneShot2D" },
{ key: "sxa582", text: "Revive BeingRevived OneShot3D" },
{ key: "sxa583", text: "Revive Effort FemaleHurt OneShot2D" },
{ key: "sxa584", text: "Revive Effort FemaleHurt OneShot3D" },
{ key: "sxa585", text: "Revive Effort MaleEpipenStab OneShot3D" },
{ key: "sxa586", text: "Revive Effort MaleHurt OneShot3D" },
{ key: "sxa587", text: "Revive Effort MaleNoseBreathing End OneShot3D" },
{ key: "sxa588", text: "Revive Epipen Prepare Distant OneShot3D" },
{ key: "sxa589", text: "Revive Epipen Prepare OneShot3D" },
{ key: "sxa590", text: "Revive FemaleNoseBreathingLoop SimpleLoop2D" },
{ key: "sxa591", text: "Revive FemaleNoseBreathingLoop SimpleLoop3D" },
{ key: "sxa592", text: "Revive GettingRevived BreathFemale SimpleLoop2D" },
{ key: "sxa593", text: "Revive GettingRevived BreathFemale SimpleLoop3D" },
{ key: "sxa594", text: "Revive GettingRevived SimpleLoop3D" },
{ key: "sxa595", text: "Revive MaleNoseBreathingLoop SimpleLoop2D" },
{ key: "sxa596", text: "Revive MaleNoseBreathingLoop SimpleLoop3D" },
{ key: "sxa597", text: "Revive Revived Foley OneShot3D" },
{ key: "sxa598", text: "Revive Revived SimpleLoop3D" },
{ key: "sxa599", text: "Revive RevivedBreath OneShot3D" },
{ key: "sxa600", text: "Revive Start OneShot3D" },
{ key: "sxa601", text: "States Local Underwater SimpleLoop2D" },
{ key: "sxa602", text: "States Local UnderwaterTransition In OneShot2D" },
{ key: "sxa603", text: "States Local UnderwaterTransition Out OneShot2D" },
{ key: "sxa604", text: "Commorose OnClose OneShot2D" },
{ key: "sxa605", text: "Commorose OnOpen OneShot2D" },
{ key: "sxa606", text: "Deploy Screen ActionSuccess OneShot2D" },
{ key: "sxa607", text: "Deploy Screen FadeIn OneShot2D" },
{ key: "sxa608", text: "Deploy Screen VehicleAvailable OneShot2D" },
{ key: "sxa609", text: "EOR Counting SimpleLoop2D" },
{ key: "sxa610", text: "EOR MasteryRankUp OneShot2D" },
{ key: "sxa611", text: "EOR NavigationTab OneShot2D" },
{ key: "sxa612", text: "EOR RankUp Extra OneShot2D" },
{ key: "sxa613", text: "EOR RankUp Normal OneShot2D" },
{ key: "sxa614", text: "EOR RoundOutcome OneShot2D" },
{ key: "sxa615", text: "EOR Vehicles Abrams OneShot OneShot2D" },
{ key: "sxa616", text: "EOR Vehicles JetFlyBy OneShot2D" },
{ key: "sxa617", text: "EOR XP OneShot2D" },
{ key: "sxa618", text: "Gamemode Shared CaptureObjectives AreaUnlock OneShot2D" },
{ key: "sxa619", text: "Gamemode Shared CaptureObjectives CaptureLeadinEnemy OneShot2D" },
{ key: "sxa620", text: "Gamemode Shared CaptureObjectives CaptureLeadinFriendly OneShot2D" },
{ key: "sxa621", text: "Gamemode Shared CaptureObjectives CaptureLeadinNeutral OneShot2D" },
{ key: "sxa622", text: "Gamemode Shared CaptureObjectives CaptureLeadinThump OneShot2D" },
{ key: "sxa623", text: "Gamemode Shared CaptureObjectives CaptureNeutralize OneShot2D" },
{ key: "sxa624", text: "Gamemode Shared CaptureObjectives CaptureStartedByEnemy OneShot2D" },
{ key: "sxa625", text: "Gamemode Shared CaptureObjectives CaptureStartedByFriendly OneShot2D" },
{ key: "sxa626", text: "Gamemode Shared CaptureObjectives CapturingDroneEnemy SimpleLoop2D" },
{ key: "sxa627", text: "Gamemode Shared CaptureObjectives CapturingDroneFriendly SimpleLoop2D" },
{ key: "sxa628", text: "Gamemode Shared CaptureObjectives CapturingThumpEnemy OneShot2D" },
{ key: "sxa629", text: "Gamemode Shared CaptureObjectives CapturingThumpFriendly OneShot2D" },
{ key: "sxa630", text: "Gamemode Shared CaptureObjectives CapturingTick IsEnemy SimpleLoop2D" },
{ key: "sxa631", text: "Gamemode Shared CaptureObjectives CapturingTick IsFriendly SimpleLoop2D" },
{ key: "sxa632", text: "Gamemode Shared CaptureObjectives CapturingTickEnemy OneShot2D" },
{ key: "sxa633", text: "Gamemode Shared CaptureObjectives CapturingTickFriendly OneShot2D" },
{ key: "sxa634", text: "Gamemode Shared CaptureObjectives CapturingTickIcon IsFriendly OneShot2D" },
{ key: "sxa635", text: "Gamemode Shared CaptureObjectives CapturingTickInBetweenEnemy OneShot2D" },
{ key: "sxa636", text: "Gamemode Shared CaptureObjectives CapturingTickInBetweenFriendly OneShot2D" },
{ key: "sxa637", text: "Gamemode Shared CaptureObjectives ObjectiveOnEnter OneShot2D" },
{ key: "sxa638", text: "Gamemode Shared CaptureObjectives ObjectiveOnExit OneShot2D" },
{ key: "sxa639", text: "Gamemode Shared CaptureObjectives ObjetiveUnlockCountdownRiser OneShot2D" },
{ key: "sxa640", text: "Gamemode Shared CaptureObjectives ObjetiveUnlockCountdownTick OneShot2D" },
{ key: "sxa641", text: "Gamemode Shared CaptureObjectives ObjetiveUnlockReveal OneShot2D" },
{ key: "sxa642", text: "Gamemode Shared CaptureObjectives OnCapturedByFriendly OneShot2D" },
{ key: "sxa643", text: "Gamemode Shared CaptureObjectives OnContested OneShot2D" },
{ key: "sxa644", text: "Gamemode Shared CaptureObjectives OnContested SimpleLoop2D" },
{ key: "sxa645", text: "Gamemode Shared Intro Countdown Final OneShot2D" },
{ key: "sxa646", text: "Gamemode Shared Intro Countdown OneShot2D" },
{ key: "sxa647", text: "Gamemode Shared Intro FinalImpact OneShot2D" },
{ key: "sxa648", text: "Gamemode Shared Intro Reveal OneShot2D" },
{ key: "sxa649", text: "Gamemode Shared Intro TransitionToCountdown OneShot2D" },
{ key: "sxa650", text: "Gamemode Shared LeadChange Negative OneShot2D" },
{ key: "sxa651", text: "Gamemode Shared LeadChange Positive OneShot2D" },
{ key: "sxa652", text: "Gamemode Shared OutOfBounds Countdown OneShot2D" },
{ key: "sxa653", text: "Gamemode Shared OutOfBounds ReturnAreaEcho OneShot2D" },
{ key: "sxa654", text: "Gamemode Shared OutOfBounds SFXLoop SimpleLoop2D" },
{ key: "sxa655", text: "Gauntlet Beacons BeaconPickup OneShot2D" },
{ key: "sxa656", text: "Gauntlet Beacons CalibrationBegin OneShot2D" },
{ key: "sxa657", text: "Gauntlet Beacons CalibrationComplete OneShot2D" },
{ key: "sxa658", text: "Gauntlet Beacons CalibrationTick OneShot2D" },
{ key: "sxa659", text: "Gauntlet Beacons CalibrationTickUrgency OneShot2D" },
{ key: "sxa660", text: "Gauntlet Beacons Drop OneShot2D" },
{ key: "sxa661", text: "Gauntlet Beacons EnemyCalibrationBeeping OneShot2D" },
{ key: "sxa662", text: "Gauntlet Beacons SignalLost OneShot2D" },
{ key: "sxa663", text: "Gauntlet Circuit ChainStateChange OneShot2D" },
{ key: "sxa664", text: "Gauntlet Circuit TerminalCaptured OneShot2D" },
{ key: "sxa665", text: "Gauntlet Circuit TerminalCaptureLoop SimpleLoop2D" },
{ key: "sxa666", text: "Gauntlet Circuit TerminalCaptureStart OneShot2D" },
{ key: "sxa667", text: "Gauntlet Circuit TerminalCaptureStop OneShot2D" },
{ key: "sxa668", text: "Gauntlet Circuit TerminalEnemyCapturing OneShot2D" },
{ key: "sxa669", text: "Gauntlet Circuit TerminalFriendlyCapturing OneShot2D" },
{ key: "sxa670", text: "Gauntlet Circuit TerminalLost OneShot2D" },
{ key: "sxa671", text: "Gauntlet Contract SquadWipe OneShot2D" },
{ key: "sxa672", text: "Gauntlet DataUpload DataDeposit OneShot2D" },
{ key: "sxa673", text: "Gauntlet DataUpload DataDepositLoop SimpleLoop2D" },
{ key: "sxa674", text: "Gauntlet DataUpload DataDepositPointDisable OneShot2D" },
{ key: "sxa675", text: "Gauntlet DataUpload DataDepositPointEnable OneShot2D" },
{ key: "sxa676", text: "Gauntlet DataUpload DataDepositStart OneShot2D" },
{ key: "sxa677", text: "Gauntlet DataUpload DataDepositStop OneShot2D" },
{ key: "sxa678", text: "Gauntlet DataUpload DataLost OneShot2D" },
{ key: "sxa679", text: "Gauntlet DataUpload DataPickup OneShot2D" },
{ key: "sxa680", text: "Gauntlet Dogtags OneShot2D" },
{ key: "sxa681", text: "Gauntlet EOM AdvanceCardArrive OneShot2D" },
{ key: "sxa682", text: "Gauntlet EOM AdvanceCardReveal OneShot2D" },
{ key: "sxa683", text: "Gauntlet EOM AdvanceScreen In OneShot2D" },
{ key: "sxa684", text: "Gauntlet EOM CountdownTick OneShot2D" },
{ key: "sxa685", text: "Gauntlet EOM Defeat OneShot2D" },
{ key: "sxa686", text: "Gauntlet EOM DefeatCardReveal OneShot2D" },
{ key: "sxa687", text: "Gauntlet EOM DefeatScreen Arrive OneShot2D" },
{ key: "sxa688", text: "Gauntlet EOM DefeatScreen Out LeadIn OneShot2D" },
{ key: "sxa689", text: "Gauntlet EOM PlayerSquadCardDetails OneShot2D" },
{ key: "sxa690", text: "Gauntlet EOM Qualified OneShot2D" },
{ key: "sxa691", text: "Gauntlet EOM Qualified ReceiveReinforcement OneShot2D" },
{ key: "sxa692", text: "Gauntlet EOM Reassigned OneShot2D" },
{ key: "sxa693", text: "Gauntlet EOM ReinforcementCardReveal OneShot2D" },
{ key: "sxa694", text: "Gauntlet EOM ReinforcementsGiven OneShot2D" },
{ key: "sxa695", text: "Gauntlet EOM ReinforcementsReceived OneShot2D" },
{ key: "sxa696", text: "Gauntlet EOM TopAdvanceCardReveal OneShot2D" },
{ key: "sxa697", text: "Gauntlet Heist AltCacheStolen OneShot2D" },
{ key: "sxa698", text: "Gauntlet Heist AltEnemyCapturedCache OneShot2D" },
{ key: "sxa699", text: "Gauntlet Heist AltFriendlyRecoveredCache OneShot2D" },
{ key: "sxa700", text: "Gauntlet Heist AltRecoveringCacheStart OneShot2D" },
{ key: "sxa701", text: "Gauntlet Heist AltRecoveringCacheStop OneShot2D" },
{ key: "sxa702", text: "Gauntlet Heist AltRecoveringCacheTimer OneShot2D" },
{ key: "sxa703", text: "Gauntlet Heist EnemyCapturedCache OneShot2D" },
{ key: "sxa704", text: "Gauntlet Heist EnemyPickedUpCache OneShot2D" },
{ key: "sxa705", text: "Gauntlet Heist FriendlyCapturedCache OneShot2D" },
{ key: "sxa706", text: "Gauntlet Heist FriendlyPickedUpCache OneShot2D" },
{ key: "sxa707", text: "Gauntlet MissionBriefing Base OneShot2D" },
{ key: "sxa708", text: "Gauntlet MissionBriefing Circuit OneShot2D" },
{ key: "sxa709", text: "Gauntlet MissionBriefing Contract OneShot2D" },
{ key: "sxa710", text: "Gauntlet MissionBriefing Decryption OneShot2D" },
{ key: "sxa711", text: "Gauntlet MissionBriefing Extraction OneShot2D" },
{ key: "sxa712", text: "Gauntlet MissionBriefing Heist OneShot2D" },
{ key: "sxa713", text: "Gauntlet MissionBriefing Rodeo OneShot2D" },
{ key: "sxa714", text: "Gauntlet MissionBriefing Standoff OneShot2D" },
{ key: "sxa715", text: "Gauntlet MissionBriefing Vendetta OneShot2D" },
{ key: "sxa716", text: "Gauntlet MissionBriefing Wreckage OneShot2D" },
{ key: "sxa717", text: "Gauntlet Qualifier Disqualified OneShot2D" },
{ key: "sxa718", text: "Gauntlet Qualifier PositionGained OneShot2D" },
{ key: "sxa719", text: "Gauntlet Qualifier PositionLost OneShot2D" },
{ key: "sxa720", text: "Gauntlet Qualifier Qualified OneShot2D" },
{ key: "sxa721", text: "Gauntlet Rodeo TankAcquired OneShot2D" },
{ key: "sxa722", text: "Gauntlet Rodeo TankKillPoint OneShot2D" },
{ key: "sxa723", text: "Gauntlet Rodeo TanksAvailable OneShot2D" },
{ key: "sxa724", text: "Gauntlet Rodeo TanksLockerUnlocking OneShot2D" },
{ key: "sxa725", text: "Gauntlet Standoff ZoneAlmostDepleted OneShot2D" },
{ key: "sxa726", text: "Gauntlet Standoff ZoneCaptured OneShot2D" },
{ key: "sxa727", text: "Gauntlet Standoff ZoneCaptureTick OneShot2D" },
{ key: "sxa728", text: "Gauntlet Standoff ZoneContested OneShot2D" },
{ key: "sxa729", text: "Gauntlet Standoff ZoneEnter OneShot2D" },
{ key: "sxa730", text: "Gauntlet Standoff ZoneExit OneShot2D" },
{ key: "sxa731", text: "Gauntlet Vendetta FriendlyHVTKilled OneShot2D" },
{ key: "sxa732", text: "Gauntlet Vendetta IncomingHVTSelection OneShot2D" },
{ key: "sxa733", text: "Gauntlet Vendetta NewHVT OneShot2D" },
{ key: "sxa734", text: "Gauntlet Vendetta PlayerKilledHVT OneShot2D" },
{ key: "sxa735", text: "Gauntlet Vendetta YouAreTheTarget OneShot2D" },
{ key: "sxa736", text: "Gauntlet Wreckage BombBeeping OneShot2D" },
{ key: "sxa737", text: "Gauntlet Wreckage BombCarrier OneShot2D" },
{ key: "sxa738", text: "Gauntlet Wreckage BombKilledSelf OneShot2D" },
{ key: "sxa739", text: "Gauntlet Wreckage BombPickup OneShot2D" },
{ key: "sxa740", text: "Gauntlet Wreckage BombPlanted OneShot2D" },
{ key: "sxa741", text: "Gauntlet Wreckage BombPlantLoop SimpleLoop2D" },
{ key: "sxa742", text: "Gauntlet Wreckage BombPlantStart OneShot2D" },
{ key: "sxa743", text: "Gauntlet Wreckage BombPlantStop OneShot2D" },
{ key: "sxa744", text: "Gauntlet Wreckage BompDropped OneShot2D" },
{ key: "sxa745", text: "Gauntlet Wreckage EnemyCarrierKilled OneShot2D" },
{ key: "sxa746", text: "Gauntlet Wreckage FriendlyBombPlanted OneShot2D" },
{ key: "sxa747", text: "Gauntlet Wreckage FuseLow OneShot2D" },
{ key: "sxa748", text: "Gauntlet Wreckage MCOMDestroyed OneShot2D" },
{ key: "sxa749", text: "Highlight A 2D" },
{ key: "sxa750", text: "Highlight B 2D" },
{ key: "sxa751", text: "MainMenu PressPlay OneShot2D" },
{ key: "sxa752", text: "Map Close OneShot2D" },
{ key: "sxa753", text: "Map MapMovement IsZooming SimpleLoop2D" },
{ key: "sxa754", text: "Map MapMovement PanSpeed SimpleLoop2D" },
{ key: "sxa755", text: "Map MapMovement PanStart OneShot2D" },
{ key: "sxa756", text: "Map MapMovement PanStop OneShot2D" },
{ key: "sxa757", text: "Map MapMovement ResetZoom OneShot2D" },
{ key: "sxa758", text: "Map MapMovement ZoomBlocked OneShot2D" },
{ key: "sxa759", text: "Map MapMovement ZoomIn OneShot2D" },
{ key: "sxa760", text: "Map MapMovement ZoomOut OneShot2D" },
{ key: "sxa761", text: "Map Open OneShot2D" },
{ key: "sxa762", text: "Matchmaking FoundMatch OneShot2D" },
{ key: "sxa763", text: "Matchmaking Start OneShot2D" },
{ key: "sxa764", text: "MenuNavigatin Profile Playercard Background OneShot2D" },
{ key: "sxa765", text: "MenuNavigatin Profile Playercard Badge OneShot2D" },
{ key: "sxa766", text: "MenuNavigatin Profile Playercard DogTag OneShot2D" },
{ key: "sxa767", text: "MenuNavigatin Profile Playercard Equip OneShot2D" },
{ key: "sxa768", text: "MenuNavigatin Profile Playercard Focus OneShot2D" },
{ key: "sxa769", text: "MenuNavigatin Profile Playercard Loading OneShot2D" },
{ key: "sxa770", text: "MenuNavigatin Profile Playercard Pin OneShot2D" },
{ key: "sxa771", text: "MenuNavigatin Profile Playercard Remove Button OneShot2D" },
{ key: "sxa772", text: "MenuNavigatin Profile Playercard Remove OneShot2D" },
{ key: "sxa773", text: "MenuNavigatin Profile Playercard Tag OneShot2D" },
{ key: "sxa774", text: "MenuNavigatin Profile Playercard Title OneShot2D" },
{ key: "sxa775", text: "MenuNavigation Challenges DateMenuSelect OneShot2D" },
{ key: "sxa776", text: "MenuNavigation Challenges HoverChallenge OneShot2D" },
{ key: "sxa777", text: "MenuNavigation Challenges HoverChallengeCategory OneShot2D" },
{ key: "sxa778", text: "MenuNavigation Challenges MultiTierChallengeSelections OneShot2D" },
{ key: "sxa779", text: "MenuNavigation Challenges RerollConfirm OneShot2D" },
{ key: "sxa780", text: "MenuNavigation Challenges RerollMenu OneShot2D" },
{ key: "sxa781", text: "MenuNavigation Challenges RerollMenuCancel OneShot2D" },
{ key: "sxa782", text: "MenuNavigation Challenges ScreenArrive OneShot2D" },
{ key: "sxa783", text: "MenuNavigation Challenges SelectChallenge OneShot2D" },
{ key: "sxa784", text: "MenuNavigation Challenges SelectChallengeCategory OneShot2D" },
{ key: "sxa785", text: "MenuNavigation Challenges Track OneShot2D" },
{ key: "sxa786", text: "MenuNavigation Challenges Untrack OneShot2D" },
{ key: "sxa787", text: "MenuNavigation Default EnumSelection OneShot2D" },
{ key: "sxa788", text: "MenuNavigation Default Focus OneShot2D" },
{ key: "sxa789", text: "MenuNavigation Default GoBack OneShot2D" },
{ key: "sxa790", text: "MenuNavigation Default Highlight OneShot2D" },
{ key: "sxa791", text: "MenuNavigation Default HoverIn OneShot2D" },
{ key: "sxa792", text: "MenuNavigation Default PrimaryActivation OneShot2D" },
{ key: "sxa793", text: "MenuNavigation Default PrimarySelect OneShot2D" },
{ key: "sxa794", text: "MenuNavigation Default SecondaryActivation OneShot2D" },
{ key: "sxa795", text: "MenuNavigation Default SecondarySelect OneShot2D" },
{ key: "sxa796", text: "MenuNavigation Default SlidersClickDown OneShot2D" },
{ key: "sxa797", text: "MenuNavigation Default ToggleOff OneShot2D" },
{ key: "sxa798", text: "MenuNavigation Default ToggleOn OneShot2D" },
{ key: "sxa799", text: "MenuNavigation Equip AddLayer OneShot2D" },
{ key: "sxa800", text: "MenuNavigation Haptics ResetpackageLoading OneShot2D" },
{ key: "sxa801", text: "MenuNavigation Haptics Shared Select OneShot2D" },
{ key: "sxa802", text: "MenuNavigation Home ActivateXPBooster OneShot2D" },
{ key: "sxa803", text: "MenuNavigation Home ExitPartyMenu OneShot2D" },
{ key: "sxa804", text: "MenuNavigation Home OpenPartyMenu OneShot2D" },
{ key: "sxa805", text: "MenuNavigation Home OpenXPBoosterWindow OneShot2D" },
{ key: "sxa806", text: "MenuNavigation Home PlayCategoryActivation OneShot2D" },
{ key: "sxa807", text: "MenuNavigation Home PlayerTabActivation OneShot2D" },
{ key: "sxa808", text: "MenuNavigation Home PlayItemHover OneShot2D" },
{ key: "sxa809", text: "MenuNavigation Home PlayItemScroll OneShot2D" },
{ key: "sxa810", text: "MenuNavigation Home ScreenArrive OneShot2D" },
{ key: "sxa811", text: "MenuNavigation Home SelectPlayCategory OneShot2D" },
{ key: "sxa812", text: "MenuNavigation Home SquadfillPrivate OneShot2D" },
{ key: "sxa813", text: "MenuNavigation Home SquadfillPublic OneShot2D" },
{ key: "sxa814", text: "MenuNavigation Home StartGame OneShot2D" },
{ key: "sxa815", text: "MenuNavigation Loadout ClickSelectLoadout OneShot2D" },
{ key: "sxa816", text: "MenuNavigation Loadout CollapseWeaponStats OneShot2D" },
{ key: "sxa817", text: "MenuNavigation Loadout EquipCharacterSkin OneShot2D" },
{ key: "sxa818", text: "MenuNavigation Loadout EquipFieldSpecCloth OneShot2D" },
{ key: "sxa819", text: "MenuNavigation Loadout EquipFieldSpecfull OneShot2D" },
{ key: "sxa820", text: "MenuNavigation Loadout EquipFieldSpecUIHit OneShot2D" },
{ key: "sxa821", text: "MenuNavigation Loadout EquipGadget OneShot2D" },
{ key: "sxa822", text: "MenuNavigation Loadout EquipKnifeMeleeKnife OneShot2D" },
{ key: "sxa823", text: "MenuNavigation Loadout EquipKnifeMeleeSledgehammer OneShot2D" },
{ key: "sxa824", text: "MenuNavigation Loadout EquippedClassProficiency OneShot2D" },
{ key: "sxa825", text: "MenuNavigation Loadout EquipPrimaryWeapon OneShot2D" },
{ key: "sxa826", text: "MenuNavigation Loadout EquipSecondaryWeapon OneShot2D" },
{ key: "sxa827", text: "MenuNavigation Loadout EquipThrowableGranade OneShot2D" },
{ key: "sxa828", text: "MenuNavigation Loadout EquipThrowableKnife OneShot2D" },
{ key: "sxa829", text: "MenuNavigation Loadout ExpandWeaponStats OneShot2D" },
{ key: "sxa830", text: "MenuNavigation Loadout Inspectactivation OneShot2D" },
{ key: "sxa831", text: "MenuNavigation Loadout ModifyWeapon OneShot2D" },
{ key: "sxa832", text: "MenuNavigation Loadout ResetPackage OneShot2D" },
{ key: "sxa833", text: "MenuNavigation Loadout ResetPackageEnd OneShot2D" },
{ key: "sxa834", text: "MenuNavigation Loadout ResetpackageLoading OneShot2D" },
{ key: "sxa835", text: "MenuNavigation Loadout ResetPackageStart OneShot2D" },
{ key: "sxa836", text: "MenuNavigation Loadout ScreenArrive OneShot2D" },
{ key: "sxa837", text: "MenuNavigation Loadout SelectCharacterSkin OneShot2D" },
{ key: "sxa838", text: "MenuNavigation Loadout Swapfaction OneShot2D" },
{ key: "sxa839", text: "MenuNavigation Loadout Testweaponactivation OneShot2D" },
{ key: "sxa840", text: "MenuNavigation Notification ToasterPopUp OneShot2D" },
{ key: "sxa841", text: "MenuNavigation Options ScreenArrive OneShot2D" },
{ key: "sxa842", text: "MenuNavigation VehicleLoadout EquipGunnerEquipment OneShot2D" },
{ key: "sxa843", text: "MenuNavigation VehicleLoadout EquipGunnerWeapon OneShot2D" },
{ key: "sxa844", text: "MenuNavigation VehicleLoadout EquipVehicleDecal OneShot2D" },
{ key: "sxa845", text: "MenuNavigation VehicleLoadout EquipVehicleEquipment OneShot2D" },
{ key: "sxa846", text: "MenuNavigation VehicleLoadout EquipVehiclePassive OneShot2D" },
{ key: "sxa847", text: "MenuNavigation VehicleLoadout EquipVehicleSkin OneShot2D" },
{ key: "sxa848", text: "MenuNavigation VehicleLoadout EquipVehicleWeapon OneShot2D" },
{ key: "sxa849", text: "MenuNavigation VehicleLoadout SelectGunnerEquipment OneShot2D" },
{ key: "sxa850", text: "MenuNavigation VehicleLoadout SelectGunnerWeapon OneShot2D" },
{ key: "sxa851", text: "MenuNavigation VehicleLoadout SelectVehicleAA OneShot2D" },
{ key: "sxa852", text: "MenuNavigation VehicleLoadout SelectVehicleArmoredCarrier OneShot2D" },
{ key: "sxa853", text: "MenuNavigation VehicleLoadout SelectVehicleAttackPlane OneShot2D" },
{ key: "sxa854", text: "MenuNavigation VehicleLoadout SelectVehicleDecal OneShot2D" },
{ key: "sxa855", text: "MenuNavigation VehicleLoadout SelectVehicleEquipment OneShot2D" },
{ key: "sxa856", text: "MenuNavigation VehicleLoadout SelectVehicleFighterPlane OneShot2D" },
{ key: "sxa857", text: "MenuNavigation VehicleLoadout SelectVehicleHelicopter OneShot2D" },
{ key: "sxa858", text: "MenuNavigation VehicleLoadout SelectVehicleIFV OneShot2D" },
{ key: "sxa859", text: "MenuNavigation VehicleLoadout SelectVehiclePassive OneShot2D" },
{ key: "sxa860", text: "MenuNavigation VehicleLoadout SelectVehicleSkin OneShot2D" },
{ key: "sxa861", text: "MenuNavigation VehicleLoadout SelectVehicleTank OneShot2D" },
{ key: "sxa862", text: "MenuNavigation VehicleLoadout SelectVehicleWeapon OneShot2D" },
{ key: "sxa863", text: "MenuNavigation VehicleLoadout VehiclePresetActivation OneShot2D" },
{ key: "sxa864", text: "MenuNavigation WeaponAttachment AlreadyEquipped OneShot2D" },
{ key: "sxa865", text: "MenuNavigation WeaponAttachment AttachmentSlot OneShot2D" },
{ key: "sxa866", text: "MenuNavigation WeaponAttachment EquipAttachment OneShot2D" },
{ key: "sxa867", text: "MenuNavigation WeaponAttachment Focus OneShot2D" },
{ key: "sxa868", text: "MenuNavigation WeaponAttachment NoPoints OneShot2D" },
{ key: "sxa869", text: "Notification FieldUpgrade Main OneShot2D" },
{ key: "sxa870", text: "Notification FieldUpgrade OnTrait OneShot2D" },
{ key: "sxa871", text: "Notification FieldUpgrade RankFinal OneShot2D" },
{ key: "sxa872", text: "Notification FieldUpgrade RankOne OneShot2D" },
{ key: "sxa873", text: "Notification FieldUpgrade RankTwo OneShot2D" },
{ key: "sxa874", text: "Notification FieldUpgrade RankUnlock OneShot2D" },
{ key: "sxa875", text: "Notification ObjectiveSecured FadeIn OneShot2D" },
{ key: "sxa876", text: "Notification ObjectiveSecured FillIn Negative OneShot2D" },
{ key: "sxa877", text: "Notification ObjectiveSecured FillIn Neutral OneShot2D" },
{ key: "sxa878", text: "Notification ObjectiveSecured FillIn Positive OneShot2D" },
{ key: "sxa879", text: "Notification Primary A 2D" },
{ key: "sxa880", text: "Notification Primary B 2D" },
{ key: "sxa881", text: "Notification Primary C 2D" },
{ key: "sxa882", text: "Notification Primary D 2D" },
{ key: "sxa883", text: "Notification Primary E 2D" },
{ key: "sxa884", text: "Notification Primary F 2D" },
{ key: "sxa885", text: "Notification Primary G 2D" },
{ key: "sxa886", text: "Notification Primary H 2D" },
{ key: "sxa887", text: "Notification Primary I 2D" },
{ key: "sxa888", text: "Notification Primary J 2D" },
{ key: "sxa889", text: "Notification SectorBonus NumberChange OneShot2D" },
{ key: "sxa890", text: "Notification SectorBonus ProgressBarFillingUp OneShot2D" },
{ key: "sxa891", text: "Notification SectorBonus ProgressBarFinished OneShot2D" },
{ key: "sxa892", text: "Notification SectorNext FadeIn OneShot2D" },
{ key: "sxa893", text: "Notification SectorNext FlyOut OneShot2D" },
{ key: "sxa894", text: "Notification SectorPerformance Start OneShot2D" },
{ key: "sxa895", text: "Notification SectorTaken Counter Negative OneShot2D" },
{ key: "sxa896", text: "Notification SectorTaken Counter Positive OneShot2D" },
{ key: "sxa897", text: "Notification SectorTaken Reveal OneShot2D" },
{ key: "sxa898", text: "Notification SharedGamemode GameModeArrows OneShot2D" },
{ key: "sxa899", text: "Notification SharedGamemode GameModeArrowsFirst OneShot2D" },
{ key: "sxa900", text: "Notification SharedGamemode GameModeArrowsSubsequent OneShot2D" },
{ key: "sxa901", text: "Notification SharedGamemode GameModeCritical OneShot2D" },
{ key: "sxa902", text: "Notification SidePanel CenterSwipeOut OneShot2D" },
{ key: "sxa903", text: "Notification SidePanel ChallengeComplete OneShot2D" },
{ key: "sxa904", text: "Notification SidePanel ChallengeCriteriaComplete OneShot2D" },
{ key: "sxa905", text: "Notification SidePanel ChallengeCriteriaProgressed Loop2D" },
{ key: "sxa906", text: "Notification SidePanel ChallengeCriteriaProgressed OneShot2D" },
{ key: "sxa907", text: "Notification SidePanel ChallengeProgressed OneShot2D" },
{ key: "sxa908", text: "Notification SidePanel Mastery OneShot2D" },
{ key: "sxa909", text: "PreRoundLobby SquadMateAdded OneShot2D" },
{ key: "sxa910", text: "PreRoundLobby SquadMateRemoved OneShot2D" },
{ key: "sxa911", text: "Scorelog AccoladeCareerBest OneShot2D" },
{ key: "sxa912", text: "Scorelog Accolades AccoladeTypes CareerBest OneShot2D" },
{ key: "sxa913", text: "Scorelog Accolades CareerBest OneShot2D" },
{ key: "sxa914", text: "Scorelog Hide OneShot2D" },
{ key: "sxa915", text: "Scorelog Show OneShot2D" },
{ key: "sxa916", text: "Select A 2D" },
{ key: "sxa917", text: "Select B 2D" },
{ key: "sxa918", text: "Select Gear A 2D" },
{ key: "sxa919", text: "Select Gear B 2D" },
{ key: "sxa920", text: "Select Gear C 2D" },
{ key: "sxa921", text: "Select Gear D 2D" },
{ key: "sxa922", text: "Select Gear E 2D" },
{ key: "sxa923", text: "Select Gear F 2D" },
{ key: "sxa924", text: "Shared Button Moist OneShot2D" },
{ key: "sxa925", text: "Shared Countdown Appear OneShot2D" },
{ key: "sxa926", text: "Shared Countdown Tick Final OneShot2D" },
{ key: "sxa927", text: "Shared Countdown Tick OneShot2D" },
{ key: "sxa928", text: "Shared Countdown Tick Urgent OneShot2D" },
{ key: "sxa929", text: "Shared Tutorial Prompt OneShot2D" },
{ key: "sxa930", text: "SP Collectibles Dogtag OneShot2D" },
{ key: "sxa931", text: "SP ObjectiveReceived In OneShot2D" },
{ key: "sxa932", text: "SP ObjectiveReceived Out OneShot2D" },
{ key: "sxa933", text: "Submenu Close 2D" },
{ key: "sxa934", text: "Submenu Open 2D" },
{ key: "sxa935", text: "OneShot2D" },
];
export const VFX_TEXT: readonly TextPair[] = [
{ key: "sxv0", text: "Airburst Incendiary Detonation" },
{ key: "sxv1", text: "Airburst Incendiary Detonation Friendly" },
{ key: "sxv2", text: "Airplane Jetwash Dirt" },
{ key: "sxv3", text: "Airplane Jetwash Grass" },
{ key: "sxv4", text: "Airplane Jetwash Sand" },
{ key: "sxv5", text: "Airplane Jetwash Snow" },
{ key: "sxv6", text: "Airplane Jetwash Water" },
{ key: "sxv7", text: "AmbWar UAV Circling" },
{ key: "sxv8", text: "ArtilleryStrike Explosion" },
{ key: "sxv9", text: "ArtilleryStrike Explosion" },
{ key: "sxv10", text: "ArtilleryStrike Explosion GS SP Beach" },
{ key: "sxv11", text: "Autocannon 30mm AP Hit" },
{ key: "sxv12", text: "Autocannon 30mm AP Hit Metal" },
{ key: "sxv13", text: "AW Distant Cluster Bomb Line Outskirts" },
{ key: "sxv14", text: "BASE Birds Black Circulating" },
{ key: "sxv15", text: "BASE Fire L" },
{ key: "sxv16", text: "BASE Fire M" },
{ key: "sxv17", text: "BASE Fire M NoSmoke" },
{ key: "sxv18", text: "BASE Fire Oil Medium" },
{ key: "sxv19", text: "BASE Fire S" },
{ key: "sxv20", text: "BASE Fire S NoSmoke" },
{ key: "sxv21", text: "BASE Flies Small" },
{ key: "sxv22", text: "BASE Seagull Flock" },
{ key: "sxv23", text: "BASE SmokeFX Column XXL" },
{ key: "sxv24", text: "BASE SmokeFX Pillar Black L" },
{ key: "sxv25", text: "BASE SmokeFX Pillar Black L Dist" },
{ key: "sxv26", text: "BASE SmokeFX Pillar White L" },
{ key: "sxv27", text: "BASE SmokeFX Soft S" },
{ key: "sxv28", text: "BASE Sparks Pulse L" },
{ key: "sxv29", text: "BD Huge Horizon Exp" },
{ key: "sxv30", text: "BD Med Horizon Exp" },
{ key: "sxv31", text: "BD Med Horizon Exp Multi" },
{ key: "sxv32", text: "Blackhawk Rotor HaloGlow" },
{ key: "sxv33", text: "Blackhawk Rotor Vortex Vapor" },
{ key: "sxv34", text: "BlackLocust Tree Branch L" },
{ key: "sxv35", text: "Bomb Mk82 AIR Detonation" },
{ key: "sxv36", text: "Bomb Mk82 AIR Trail Ballute AirStrike" },
{ key: "sxv37", text: "BreachingDart Breach Detonation" },
{ key: "sxv38", text: "BreachingDart Generic BreachthroughSmoke" },
{ key: "sxv39", text: "BreachingDart NoBreach Detonation" },
{ key: "sxv40", text: "Building FallingDustSand" },
{ key: "sxv41", text: "Bullet L Vegetation DeadLeaves PropDest" },
{ key: "sxv42", text: "CAP AmbWar Rocket Strike" },
{ key: "sxv43", text: "Car Fire M" },
{ key: "sxv44", text: "CarFire Bumper" },
{ key: "sxv45", text: "CarFire FrameCrawl" },
{ key: "sxv46", text: "CarlGustaf MK4 Impact" },
{ key: "sxv47", text: "Carrier Explosion Dist" },
{ key: "sxv48", text: "Chaingun 30mm HEDP Hit" },
{ key: "sxv49", text: "CIN MFX Large Static Fire" },
{ key: "sxv50", text: "CIN MFX Large Static VortexFire" },
{ key: "sxv51", text: "CIN MFX Medium Static Fire" },
{ key: "sxv52", text: "CIN MFX Medium Static SmokeFX" },
{ key: "sxv53", text: "CIN MFX Small Static Fire" },
{ key: "sxv54", text: "CIN MFX Small Static SmokeFX" },
{ key: "sxv55", text: "CivCar SUV Explosion" },
{ key: "sxv56", text: "CivCar Tire fire S" },
{ key: "sxv57", text: "Cloud Cluster" },
{ key: "sxv58", text: "Cloud Cluster Storm" },
{ key: "sxv59", text: "Cloud Cluster Towering" },
{ key: "sxv60", text: "Cloud DistantBank" },
{ key: "sxv61", text: "Cloud Fractus Medium" },
{ key: "sxv62", text: "Cloud Fractus Small" },
{ key: "sxv63", text: "Decoy Destruction" },
{ key: "sxv64", text: "Defib Shock Heal Full" },
{ key: "sxv65", text: "Defib Shock Heal Half" },
{ key: "sxv66", text: "Defib Shock Hurt Full" },
{ key: "sxv67", text: "Defib Shock Hurt Half" },
{ key: "sxv68", text: "DeployableCover Deploy Dirt" },
{ key: "sxv69", text: "DeployableCover Destruction" },
{ key: "sxv70", text: "EODBot Active Enemy" },
{ key: "sxv71", text: "EODBot Active Friendly" },
{ key: "sxv72", text: "EODBot RepairTool Torch 1P" },
{ key: "sxv73", text: "EODBot RepairTool Torch 3P" },
{ key: "sxv74", text: "Gadget AdrenalineShot" },
{ key: "sxv75", text: "Gadget AirburstLauncher Detonation" },
{ key: "sxv76", text: "Gadget AirburstLauncher Predicted Line" },
{ key: "sxv77", text: "Gadget AirburstLauncher Predicted Point" },
{ key: "sxv78", text: "Gadget AirburstLauncher Predicted Point GroundConnect" },
{ key: "sxv79", text: "Gadget AmmoCrate Area" },
{ key: "sxv80", text: "Gadget AT Mine Detonation" },
{ key: "sxv81", text: "Gadget AT4 Launch 1P" },
{ key: "sxv82", text: "Gadget AT4 Launch 3P" },
{ key: "sxv83", text: "Gadget AT4 Projectile Trail" },
{ key: "sxv84", text: "Gadget Binoculars ScopeGlint" },
{ key: "sxv85", text: "Gadget C4 Explosives Detonation" },
{ key: "sxv86", text: "Gadget C4 Explosives Detonation Underwater" },
{ key: "sxv87", text: "Gadget Defib LED" },
{ key: "sxv88", text: "Gadget Defib Recharge LED" },
{ key: "sxv89", text: "Gadget DeployableMortar Destruction" },
{ key: "sxv90", text: "Gadget DeployableMortar Detonation" },
{ key: "sxv91", text: "Gadget DeployableMortar Detonation Underwater" },
{ key: "sxv92", text: "Gadget DeployableMortar FireEffect 1P" },
{ key: "sxv93", text: "Gadget DeployableMortar FireEffect 3P" },
{ key: "sxv94", text: "Gadget DeployableMortar Projectile Trail" },
{ key: "sxv95", text: "Gadget DeployableMortar Target Area" },
{ key: "sxv96", text: "Gadget Drone Destruction" },
{ key: "sxv97", text: "Gadget Drone NavLights" },
{ key: "sxv98", text: "Gadget Drone OutOfRange Distortion" },
{ key: "sxv99", text: "Gadget Drone ThermalVE" },
{ key: "sxv100", text: "Gadget EIDOS Active" },
{ key: "sxv101", text: "Gadget EIDOS Destruction" },
{ key: "sxv102", text: "Gadget EIDOS Intercept Detonation" },
{ key: "sxv103", text: "Gadget EIDOS Lights Active" },
{ key: "sxv104", text: "Gadget EIDOS Lights Standby" },
{ key: "sxv105", text: "Gadget EIDOS Projectile Launch" },
{ key: "sxv106", text: "Gadget EIDOS Standby" },
{ key: "sxv107", text: "Gadget EODBot Clusterbomb Separation" },
{ key: "sxv108", text: "Gadget EODBot ClusterFragmentCharge Detonation" },
{ key: "sxv109", text: "Gadget EODBot Destruction" },
{ key: "sxv110", text: "Gadget EODBot ObjectiveInteraction" },
{ key: "sxv111", text: "Gadget Generic Destruction" },
{ key: "sxv112", text: "Gadget Generic Destruction Electronic" },
{ key: "sxv113", text: "Gadget Generic Tripod Destruction" },
{ key: "sxv114", text: "Gadget IGLA Launch 1P" },
{ key: "sxv115", text: "Gadget IGLA Launch 3P" },
{ key: "sxv116", text: "Gadget InterativeSpectator Camera Light Green" },
{ key: "sxv117", text: "Gadget InterativeSpectator Camera Light Red" },
{ key: "sxv118", text: "Gadget InterativeSpectator Camera Light Yellow" },
{ key: "sxv119", text: "Gadget IntSpec Drone Damage Heavy" },
{ key: "sxv120", text: "Gadget IntSpec Drone Damage Light" },
{ key: "sxv121", text: "Gadget Javelin Launch 1P" },
{ key: "sxv122", text: "Gadget Javelin Launch 3P" },
{ key: "sxv123", text: "Gadget M320 Reload ShellCasing" },
{ key: "sxv124", text: "Gadget M320 Reload SmokeFX" },
{ key: "sxv125", text: "Gadget M4 SLAM Detonation" },
{ key: "sxv126", text: "Gadget MBTLAW Launch 1P" },
{ key: "sxv127", text: "Gadget MBTLAW Launch 3P" },
{ key: "sxv128", text: "Gadget Mine AT Warning Light" },
{ key: "sxv129", text: "Gadget MobileRespawn Damaged" },
{ key: "sxv130", text: "Gadget MPAPS Active" },
{ key: "sxv131", text: "Gadget MPAPS Destruction" },
{ key: "sxv132", text: "Gadget MPAPS Intercept Detonation" },
{ key: "sxv133", text: "Gadget MPAPS Lights Active" },
{ key: "sxv134", text: "Gadget MPAPS Lights Standby" },
{ key: "sxv135", text: "Gadget MPAPS Projectile Launch" },
{ key: "sxv136", text: "Gadget MPAPS Standby" },
{ key: "sxv137", text: "Gadget PTKM EFP Hit" },
{ key: "sxv138", text: "Gadget PTKM EFP Trail" },
{ key: "sxv139", text: "Gadget PTKM Mine Launch" },
{ key: "sxv140", text: "Gadget PTKM Submunition Detonation" },
{ key: "sxv141", text: "Gadget PTKM Submunition Trail" },
{ key: "sxv142", text: "Gadget ReconDrone EMP Hit" },
{ key: "sxv143", text: "Gadget ReconDrone EMP Weapon Fire" },
{ key: "sxv144", text: "Gadget RemoteTurret Box Damage" },
{ key: "sxv145", text: "Gadget RemoteTurret Box Damage Top" },
{ key: "sxv146", text: "Gadget RemoteTurret Box WreckState" },
{ key: "sxv147", text: "Gadget RemoteTurret Damage Light" },
{ key: "sxv148", text: "Gadget RemoteTurret ScreenEffect Damage" },
{ key: "sxv149", text: "Gadget RemoteTurret SmokeFX Open" },
{ key: "sxv150", text: "Gadget RPG7V2 Launch 1P" },
{ key: "sxv151", text: "Gadget RPG7V2 Launch 3P" },
{ key: "sxv152", text: "Gadget Sabotage 01 StartSparks" },
{ key: "sxv153", text: "Gadget Sabotage 02 SparkLoop" },
{ key: "sxv154", text: "Gadget Sabotage 02 SparkLoop SidePannel" },
{ key: "sxv155", text: "Gadget Sabotage 03 Fizzle" },
{ key: "sxv156", text: "Gadget ScreenEffect Thermal BHOT" },
{ key: "sxv157", text: "Gadget ScreenEffect Thermal WHOT" },
{ key: "sxv158", text: "Gadget SmokeBarrage AirBurst Det" },
{ key: "sxv159", text: "Gadget SmokeBarrage Cluster Det" },
{ key: "sxv160", text: "Gadget SmokeBarrage Cluster Light1" },
{ key: "sxv161", text: "Gadget SmokeBarrage Cluster Trail" },
{ key: "sxv162", text: "Gadget SmokeBarrage Cluster VE" },
{ key: "sxv163", text: "Gadget SniperDecoy Destruction" },
{ key: "sxv164", text: "Gadget SniperDecoy LensFlare" },
{ key: "sxv165", text: "Gadget SpawnBeacon Active" },
{ key: "sxv166", text: "Gadget SpawnBeacon Destruction" },
{ key: "sxv167", text: "Gadget StickyGrenade Detonation" },
{ key: "sxv168", text: "Gadget Stinger Launch 1P" },
{ key: "sxv169", text: "Gadget Stinger Launch 3P" },
{ key: "sxv170", text: "Gadget SupplyCrate Destruction" },
{ key: "sxv171", text: "Gadget SupplyCrate Range Indicator" },
{ key: "sxv172", text: "Gadget SupplyCrate Range Indicator Upgraded" },
{ key: "sxv173", text: "Gadget SupplyDrop Destruction" },
{ key: "sxv174", text: "Gadget Trophy Range Indicator" },
{ key: "sxv175", text: "Gadget TUGS Active" },
{ key: "sxv176", text: "Gadget TUGS Destruction" },
{ key: "sxv177", text: "Gadget VehicleRessuplyCrate Destruction" },
{ key: "sxv178", text: "Gadget VehicleSupplyCrate Range Indicator" },
{ key: "sxv179", text: "Gadget VehicleSupplyCrate Range Indicator Upgraded" },
{ key: "sxv180", text: "Granite Strike SmokeFX Marker Green" },
{ key: "sxv181", text: "Granite Strike SmokeFX Marker Red" },
{ key: "sxv182", text: "Granite Strike SmokeFX Marker Violet" },
{ key: "sxv183", text: "Granite Strike SmokeFX Marker Yellow" },
{ key: "sxv184", text: "Grenade 40mm AT Detonation" },
{ key: "sxv185", text: "Grenade 40mm HE Detonation" },
{ key: "sxv186", text: "Grenade 40mm HE Detonation Underwater" },
{ key: "sxv187", text: "Grenade 40mm Thermobaric Detonation" },
{ key: "sxv188", text: "Grenade AntiTank Detonation" },
{ key: "sxv189", text: "Grenade AntiTank Trail" },
{ key: "sxv190", text: "Grenade BreachingDart Stuck" },
{ key: "sxv191", text: "Grenade BreachingDart Trail Flashbang" },
{ key: "sxv192", text: "Grenade BreachingDartFlashbang BurnIn ScreenEffect" },
{ key: "sxv193", text: "Grenade BreachingDartFlashbang Detonation" },
{ key: "sxv194", text: "Grenade Concussion Detonation" },
{ key: "sxv195", text: "Grenade Concussion ScreenEffect" },
{ key: "sxv196", text: "Grenade Flashbang BurnIn ScreenEffect" },
{ key: "sxv197", text: "Grenade Flashbang Detonation" },
{ key: "sxv198", text: "Grenade Flashbang ScreenEffect" },
{ key: "sxv199", text: "Grenade Fragmentation Detonation" },
{ key: "sxv200", text: "Grenade Fragmentation Detonation Underwater" },
{ key: "sxv201", text: "Grenade Fragmentation ImpactGrenade Detonation" },
{ key: "sxv202", text: "Grenade Fragmentation MiniV40 Detonation" },
{ key: "sxv203", text: "Grenade Fragmentation Trail" },
{ key: "sxv204", text: "Grenade Incendiary Detonation" },
{ key: "sxv205", text: "Grenade Incendiary Trail" },
{ key: "sxv206", text: "Grenade M67 Fragmentation Trail" },
{ key: "sxv207", text: "Grenade M84 Flashbang Trail" },
{ key: "sxv208", text: "Grenade MK32A Concussion Trail" },
{ key: "sxv209", text: "Grenade RGO Impact Trail" },
{ key: "sxv210", text: "Grenade SignalSmoke" },
{ key: "sxv211", text: "Grenade SignalSmoke INV" },
{ key: "sxv212", text: "Grenade SmokeFX Detonation" },
{ key: "sxv213", text: "Grenade SmokeFX Detonation Upgraded" },
{ key: "sxv214", text: "Grenade SmokeFX Trail" },
{ key: "sxv215", text: "Impact LoadoutCrate Bricks" },
{ key: "sxv216", text: "Impact LoadoutCrate Dirt" },
{ key: "sxv217", text: "Impact LoadoutCrate Generic" },
{ key: "sxv218", text: "Impact LoadoutCrate Metal" },
{ key: "sxv219", text: "Impact LoadoutCrate Mud" },
{ key: "sxv220", text: "Impact LoadoutCrate Sand" },
{ key: "sxv221", text: "Impact LoadoutCrate Stone" },
{ key: "sxv222", text: "Impact LoadoutCrate Wood" },
{ key: "sxv223", text: "Impact LootCrate Dirt" },
{ key: "sxv224", text: "Impact LootCrate Generic" },
{ key: "sxv225", text: "Impact SafeImpact Brick" },
{ key: "sxv226", text: "Impact SafeImpact Dirt" },
{ key: "sxv227", text: "Impact SafeImpact Generic" },
{ key: "sxv228", text: "Impact SafeImpact Gravel" },
{ key: "sxv229", text: "Impact SafeImpact Metal" },
{ key: "sxv230", text: "Impact SafeImpact Mud" },
{ key: "sxv231", text: "Impact SafeImpact Sand" },
{ key: "sxv232", text: "Impact SafeImpact Water" },
{ key: "sxv233", text: "Impact SafeImpact Wood" },
{ key: "sxv234", text: "Impact SupplyDrop Brick" },
{ key: "sxv235", text: "Impact SupplyDrop Dirt" },
{ key: "sxv236", text: "Impact SupplyDrop Gravel" },
{ key: "sxv237", text: "Impact Supplydrop Metal" },
{ key: "sxv238", text: "Impact SupplyDrop Mud" },
{ key: "sxv239", text: "Impact SupplyDrop Sand" },
{ key: "sxv240", text: "Impact SupplyDrop Water" },
{ key: "sxv241", text: "Impact SupplyDrop Wood" },
{ key: "sxv242", text: "LoadoutCrate AirSpawn" },
{ key: "sxv243", text: "LoadoutCrate Drop Trails" },
{ key: "sxv244", text: "MFX M320 1P" },
{ key: "sxv245", text: "MFX M320 3P" },
{ key: "sxv246", text: "MFX TRR8 1P" },
{ key: "sxv247", text: "MFX TRR8 3P" },
{ key: "sxv248", text: "Mine M18 Claymore Detonation" },
{ key: "sxv249", text: "Mine M18 Claymore Laser Tripwire" },
{ key: "sxv250", text: "Missile IGLA Trail" },
{ key: "sxv251", text: "Missile Javelin" },
{ key: "sxv252", text: "Missile Javelin Detonation" },
{ key: "sxv253", text: "Missile Javelin Detonation Underwater" },
{ key: "sxv254", text: "Missile Javelin Launch SmokeTrail" },
{ key: "sxv255", text: "Missile MBTLAW Hit" },
{ key: "sxv256", text: "Missile MBTLAW Hit Critical" },
{ key: "sxv257", text: "Missile MBTLAW Hit Glancing" },
{ key: "sxv258", text: "Missile MBTLAW Trail" },
{ key: "sxv259", text: "Missile Stinger Trail" },
{ key: "sxv260", text: "Panzerfaust Projectile Stabilizers" },
{ key: "sxv261", text: "ProjectileTrail BreachingDart" },
{ key: "sxv262", text: "ProjectileTrail M320 Incendiary" },
{ key: "sxv263", text: "ProjectileTrail M320 Lethal" },
{ key: "sxv264", text: "ProjectileTrail M320 NonLethal" },
{ key: "sxv265", text: "ProximityGrenade Ping Flash" },
{ key: "sxv266", text: "ProximityGrenade Trail" },
{ key: "sxv267", text: "RepairTool FullyHealed" },
{ key: "sxv268", text: "RepairTool Overheat 1P" },
{ key: "sxv269", text: "RepairTool Overheat 3P" },
{ key: "sxv270", text: "RepairTool Sparks 1P" },
{ key: "sxv271", text: "RepairTool Sparks 3P" },
{ key: "sxv272", text: "RepairTool Sparks Damage" },
{ key: "sxv273", text: "RepairTool Torch 1P" },
{ key: "sxv274", text: "RepairTool Torch 3P" },
{ key: "sxv275", text: "Rocket ArmorPiercing Hit Metal" },
{ key: "sxv276", text: "Rocket RPG7V2 Dud" },
{ key: "sxv277", text: "Rocket RPG7V2 Hit" },
{ key: "sxv278", text: "Rocket RPG7V2 Hit Critical" },
{ key: "sxv279", text: "Rocket RPG7V2 Hit Glancing" },
{ key: "sxv280", text: "Rocket RPG7V2 Trail" },
{ key: "sxv281", text: "Rocket RPG7V2 Trail SP" },
{ key: "sxv282", text: "ShellEjection DP12 12g Buckshot" },
{ key: "sxv283", text: "SmokeFX Marker Custom" },
{ key: "sxv284", text: "Snow BlowingSnow L" },
{ key: "sxv285", text: "Snow BlowingSnow M" },
{ key: "sxv286", text: "Snow BlowingSnow S" },
{ key: "sxv287", text: "Snow BlowingSnow S 01 inShadow" },
{ key: "sxv288", text: "Snow BlowingSnow XS" },
{ key: "sxv289", text: "Snow DriftingSnow Rooftop Bridge" },
{ key: "sxv290", text: "Snow DriftingSnow Rooftop S" },
{ key: "sxv291", text: "Snow WhiteLeaves" },
{ key: "sxv292", text: "SoldierScreen HealingStarted" },
{ key: "sxv293", text: "SP Glint Collectable" },
{ key: "sxv294", text: "Sparks" },
{ key: "sxv295", text: "SupplyVehicleStation Range Indicator" },
{ key: "sxv296", text: "ThrowingKnife Trail" },
{ key: "sxv297", text: "ThrowingKnife Trail Friendly" },
{ key: "sxv298", text: "TracerDart Projectile Glow" },
{ key: "sxv299", text: "Vehicle Car Destruction Death Explosion PTV" },
{ key: "sxv300", text: "Vehicle CriticalState PTV" },
{ key: "sxv301", text: "Vehicle Damage PTV Critical" },
{ key: "sxv302", text: "Vehicle Damage PTV Heavy" },
{ key: "sxv303", text: "Vehicle Damage PTV Light" },
{ key: "sxv304", text: "Vehicle InstSpec Drone Explosion" },
{ key: "sxv305", text: "Vehicle PTV WheelTracks GroundDecal" },
{ key: "sxv306", text: "Vehicle Sabotage Sequence" },
{ key: "sxv307", text: "Vehicle Wreck PTV" },
{ key: "sxv308", text: "Vehicle Wreck PTV Calm" },
{ key: "sxv309", text: "Launchers GroundShockwave Dirt" },
{ key: "sxv310", text: "Launchers GroundShockwave Grass" },
{ key: "sxv311", text: "WireGuidedMissile SpooledWire" },
];
export const CATEGORY_TEXT: readonly TextPair[] = [
{ key: "sxg0", text: "Alarm" },
{ key: "sxg1", text: "Destruction_Buildings" },
{ key: "sxg2", text: "Destruction_Fuse" },
{ key: "sxg3", text: "Destruction_Impacts" },
{ key: "sxg4", text: "Destruction_Old" },
{ key: "sxg5", text: "Destruction_PreAmble" },
{ key: "sxg6", text: "Destruction_Props" },
{ key: "sxg7", text: "Destruction_Structural" },
{ key: "sxg8", text: "Destruction_Structures" },
{ key: "sxg9", text: "Destruction_Tree" },
{ key: "sxg10", text: "Gadgets_AdrenalineShot" },
{ key: "sxg11", text: "Gadgets_ATMine" },
{ key: "sxg12", text: "Gadgets_C4" },
{ key: "sxg13", text: "Gadgets_ConcussionGrenade" },
{ key: "sxg14", text: "Gadgets_Decoy" },
{ key: "sxg15", text: "Gadgets_Defibrillator" },
{ key: "sxg16", text: "Gadgets_DeployableCover" },
{ key: "sxg17", text: "Gadgets_Drone" },
{ key: "sxg18", text: "Gadgets_EIDOS" },
{ key: "sxg19", text: "Gadgets_EoDBot" },
{ key: "sxg20", text: "Gadgets_EpiPen" },
{ key: "sxg21", text: "Gadgets_Flashbang" },
{ key: "sxg22", text: "Gadgets_SupplyDrop" },
{ key: "sxg23", text: "GameModes_BR" },
{ key: "sxg24", text: "GameModes_Gauntlet" },
{ key: "sxg25", text: "Gamemodes_Payload" },
{ key: "sxg26", text: "GameModes_Rush" },
{ key: "sxg27", text: "Levels_Brooklyn" },
{ key: "sxg28", text: "Levels_Cairo" },
{ key: "sxg29", text: "Projectiles_Flybys" },
{ key: "sxg30", text: "Projectiles_FlyBys" },
{ key: "sxg31", text: "Soldier_Damage" },
{ key: "sxg32", text: "Soldier_Events" },
{ key: "sxg33", text: "Soldier_FieldUpgrade" },
{ key: "sxg34", text: "Soldier_Health" },
{ key: "sxg35", text: "Soldier_Interact" },
{ key: "sxg36", text: "Soldier_Melee" },
{ key: "sxg37", text: "Soldier_Movement" },
{ key: "sxg38", text: "Soldier_Parachute" },
{ key: "sxg39", text: "Soldier_Ragdoll" },
{ key: "sxg40", text: "Soldier_Revive" },
{ key: "sxg41", text: "Soldier_States" },
{ key: "sxg42", text: "UI_Commorose" },
{ key: "sxg43", text: "UI_Deploy" },
{ key: "sxg44", text: "UI_EOR" },
{ key: "sxg45", text: "UI_Gamemode" },
{ key: "sxg46", text: "UI_Gauntlet" },
{ key: "sxg47", text: "UI_Highlight" },
{ key: "sxg48", text: "UI_MainMenu" },
{ key: "sxg49", text: "UI_Map" },
{ key: "sxg50", text: "UI_Matchmaking" },
{ key: "sxg51", text: "UI_MenuNavigatin" },
{ key: "sxg52", text: "UI_MenuNavigation" },
{ key: "sxg53", text: "UI_Notification" },
{ key: "sxg54", text: "UI_PreRoundLobby" },
{ key: "sxg55", text: "UI_Scorelog" },
{ key: "sxg56", text: "UI_Select" },
{ key: "sxg57", text: "UI_Shared" },
{ key: "sxg58", text: "UI_SP" },
{ key: "sxg59", text: "UI_Submenu" },
{ key: "sxg60", text: "VOModule_OneShot2D" },
{ key: "sxg61", text: "Airburst" },
{ key: "sxg62", text: "Airplane" },
{ key: "sxg63", text: "AmbWar" },
{ key: "sxg64", text: "ArtilleryStrike" },
{ key: "sxg65", text: "Autocannon" },
{ key: "sxg66", text: "AW" },
{ key: "sxg67", text: "BASE" },
{ key: "sxg68", text: "BD" },
{ key: "sxg69", text: "Blackhawk" },
{ key: "sxg70", text: "BlackLocust" },
{ key: "sxg71", text: "Bomb" },
{ key: "sxg72", text: "BreachingDart" },
{ key: "sxg73", text: "Building" },
{ key: "sxg74", text: "Bullet" },
{ key: "sxg75", text: "CAP" },
{ key: "sxg76", text: "Car" },
{ key: "sxg77", text: "CarFire" },
{ key: "sxg78", text: "CarlGustaf" },
{ key: "sxg79", text: "Carrier" },
{ key: "sxg80", text: "Chaingun" },
{ key: "sxg81", text: "CIN" },
{ key: "sxg82", text: "CivCar" },
{ key: "sxg83", text: "Cloud" },
{ key: "sxg84", text: "Decoy" },
{ key: "sxg85", text: "Defib" },
{ key: "sxg86", text: "DeployableCover" },
{ key: "sxg87", text: "EODBot" },
{ key: "sxg88", text: "Gadget" },
{ key: "sxg89", text: "Granite" },
{ key: "sxg90", text: "Grenade" },
{ key: "sxg91", text: "Impact" },
{ key: "sxg92", text: "LoadoutCrate" },
{ key: "sxg93", text: "MF" },
{ key: "sxg94", text: "Mine" },
{ key: "sxg95", text: "Missile" },
{ key: "sxg96", text: "Panzerfaust" },
{ key: "sxg97", text: "ProjectileTrail" },
{ key: "sxg98", text: "ProximityGrenade" },
{ key: "sxg99", text: "RepairTool" },
{ key: "sxg100", text: "Rocket" },
{ key: "sxg101", text: "ShellEjection" },
{ key: "sxg102", text: "Smoke" },
{ key: "sxg103", text: "Snow" },
{ key: "sxg104", text: "SoldierScreen" },
{ key: "sxg105", text: "SP" },
{ key: "sxg106", text: "Sparks" },
{ key: "sxg107", text: "SupplyVehicleStation" },
{ key: "sxg108", text: "ThrowingKnife" },
{ key: "sxg109", text: "TracerDart" },
{ key: "sxg110", text: "Vehicle" },
{ key: "sxg111", text: "VFX" },
{ key: "sxg112", text: "WireGuidedMissile" },
];
export const PREFIX_TEXT: readonly TextPair[] = [
{ key: "sxp0", text: "UI" },
{ key: "sxp1", text: "Soldier" },
{ key: "sxp2", text: "Levels" },
{ key: "sxp3", text: "Gadgets" },
{ key: "sxp4", text: "Destruction" },
{ key: "sxp5", text: "GameModes" },
{ key: "sxp6", text: "Projectiles" },
{ key: "sxp7", text: "Alarm" },
{ key: "sxp8", text: "VOModule" },
{ key: "sxp9", text: "Gadget" },
{ key: "sxp10", text: "Grenade" },
{ key: "sxp11", text: "Impact" },
{ key: "sxp12", text: "BASE" },
{ key: "sxp13", text: "Missile" },
{ key: "sxp14", text: "Vehicle" },
{ key: "sxp15", text: "RepairTool" },
{ key: "sxp16", text: "Snow" },
{ key: "sxp17", text: "Rocket" },
{ key: "sxp18", text: "CIN" },
{ key: "sxp19", text: "Cloud" },
{ key: "sxp20", text: "Airplane" },
{ key: "sxp21", text: "Defib" },
{ key: "sxp22", text: "EODBot" },
{ key: "sxp23", text: "Granite" },
{ key: "sxp24", text: "MF" },
{ key: "sxp25", text: "ProjectileTrail" },
{ key: "sxp26", text: "ArtilleryStrike" },
{ key: "sxp27", text: "BD" },
{ key: "sxp28", text: "BreachingDart" },
{ key: "sxp29", text: "Airburst" },
{ key: "sxp30", text: "Autocannon" },
{ key: "sxp31", text: "Blackhawk" },
{ key: "sxp32", text: "Bomb" },
{ key: "sxp33", text: "CarFire" },
{ key: "sxp34", text: "CivCar" },
{ key: "sxp35", text: "DeployableCover" },
{ key: "sxp36", text: "Launchers" },
{ key: "sxp37", text: "LoadoutCrate" },
{ key: "sxp38", text: "Mine" },
{ key: "sxp39", text: "ProximityGrenade" },
{ key: "sxp40", text: "ThrowingKnife" },
{ key: "sxp41", text: "AmbWar" },
{ key: "sxp42", text: "AW" },
{ key: "sxp43", text: "BlackLocust" },
{ key: "sxp44", text: "Building" },
{ key: "sxp45", text: "Bullet" },
{ key: "sxp46", text: "CAP" },
{ key: "sxp47", text: "Car" },
{ key: "sxp48", text: "CarlGustaf" },
{ key: "sxp49", text: "Carrier" },
{ key: "sxp50", text: "Chaingun" },
{ key: "sxp51", text: "Decoy" },
{ key: "sxp52", text: "Panzerfaust" },
{ key: "sxp53", text: "ShellEjection" },
{ key: "sxp54", text: "Smoke" },
{ key: "sxp55", text: "SoldierScreen" },
{ key: "sxp56", text: "SP" },
{ key: "sxp57", text: "Sparks" },
{ key: "sxp58", text: "SupplyVehicleStation" },
{ key: "sxp59", text: "TracerDart" },
{ key: "sxp60", text: "WireGuidedMissile" },
];
// --- SOURCE: src\config.ts ---
export const CONFIG = {
rayLength: 100,
playGlyph: "P",
spawnGlyph: "S",
effectGlyph: "T",
defaultAmplitude: 0.8,
amplitudeStep: 0.1,
minAmplitude: 0.1,
maxAmplitude: 1.0,
maxSoundsPerPlayer: 16,
defaultRange: 40,
rangeStep: 10,
minRange: 10,
maxRange: 120,
defaultScale: 1.0,
scaleStep: 0.1,
minScale: 0.25,
maxScale: 4.0,
maxSpawnedPerPlayer: 24,
vfxTopGroups: 28,
vfxColor: [1.0, 1.0, 1.0] as const,
widgetsPerBatch: 30,
widgetBatchDelayMs: 100,
qrWidgetsPerTick: 30,
qrSite: "https://kurtinthe-grind.github.io/SfxVfxShowcase/",
musicLoadMs: 5000,
uiSoundMs: 2000,
uiSoundAmp: 1.0,
} as const;
// --- SOURCE: node_modules\bf6-portal-utils\vectors\index.ts ---
export namespace Vectors {
export type Vector3 = {
x: number;
y: number;
z: number;
};
export const ZERO: Readonly<Vector3> = Object.freeze({ x: 0, y: 0, z: 0 });
export const ONE: Readonly<Vector3> = Object.freeze({ x: 1, y: 1, z: 1 });
export function set(target: Vector3, x: number, y: number, z: number): Vector3 {
target.x = x;
target.y = y;
target.z = z;
return target;
}
export function copy(target: Vector3, source: Vector3): Vector3 {
target.x = source.x;
target.y = source.y;
target.z = source.z;
return target;
}
export function clone(source: Vector3): Vector3 {
return { x: source.x, y: source.y, z: source.z };
}
export function equals(a: Vector3, b: Vector3, tolerance: number = 0): boolean {
return tolerance === 0
? a.x === b.x && a.y === b.y && a.z === b.z
: Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.z - b.z) <= tolerance;
}
export function isZero(vector: Vector3, tolerance: number = 0): boolean {
return tolerance === 0
? vector.x === 0 && vector.y === 0 && vector.z === 0
: Math.abs(vector.x) <= tolerance && Math.abs(vector.y) <= tolerance && Math.abs(vector.z) <= tolerance;
}
export function toVector(vector: Vector3): mod.Vector {
return mod.CreateVector(vector.x, vector.y, vector.z);
}
export function toVector3(vector: mod.Vector, out?: Vector3): Vector3 {
const x = mod.XComponentOf(vector);
const y = mod.YComponentOf(vector);
const z = mod.ZComponentOf(vector);
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function add(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
const x = a.x + b.x;
const y = a.y + b.y;
const z = a.z + b.z;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function addScaled(a: Vector3, b: Vector3, scale: number, out?: Vector3): Vector3 {
const x = a.x + b.x * scale;
const y = a.y + b.y * scale;
const z = a.z + b.z * scale;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function subtract(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
const x = a.x - b.x;
const y = a.y - b.y;
const z = a.z - b.z;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function multiply(vector: Vector3, scalar: number, out?: Vector3): Vector3 {
const x = vector.x * scalar;
const y = vector.y * scalar;
const z = vector.z * scalar;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function divide(vector: Vector3, scalar: number, out?: Vector3): Vector3 {
const x = vector.x / scalar;
const y = vector.y / scalar;
const z = vector.z / scalar;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function hadamardMultiply(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
const x = a.x * b.x;
const y = a.y * b.y;
const z = a.z * b.z;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function hadamardDivide(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
const x = a.x / b.x;
const y = a.y / b.y;
const z = a.z / b.z;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function dot(a: Vector3, b: Vector3): number {
return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function cross(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
const ax = a.x;
const ay = a.y;
const az = a.z;
const bx = b.x;
const by = b.y;
const bz = b.z;
const x = ay * bz - az * by;
const y = az * bx - ax * bz;
const z = ax * by - ay * bx;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function lengthSquared(vector: Vector3): number {
return vector.x * vector.x + vector.y * vector.y + vector.z * vector.z;
}
export function length(vector: Vector3): number {
return Math.sqrt(lengthSquared(vector));
}
export function normalize(vector: Vector3, out?: Vector3): Vector3 {
const len = length(vector);
if (len === 0) {
if (!out) return { x: 0, y: 0, z: 0 };
out.x = 0;
out.y = 0;
out.z = 0;
return out;
}
const x = vector.x / len;
const y = vector.y / len;
const z = vector.z / len;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function direction(from: Vector3, to: Vector3, out?: Vector3): Vector3 {
const dx = to.x - from.x;
const dy = to.y - from.y;
const dz = to.z - from.z;
const lenSq = dx * dx + dy * dy + dz * dz;
if (lenSq === 0) {
if (!out) return { x: 0, y: 0, z: 0 };
out.x = 0;
out.y = 0;
out.z = 0;
return out;
}
const invLen = 1 / Math.sqrt(lenSq);
const x = dx * invLen;
const y = dy * invLen;
const z = dz * invLen;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function lerp(a: Vector3, b: Vector3, t: number, out?: Vector3): Vector3 {
const x = a.x + (b.x - a.x) * t;
const y = a.y + (b.y - a.y) * t;
const z = a.z + (b.z - a.z) * t;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function midpoint(a: Vector3, b: Vector3, out?: Vector3): Vector3 {
return lerp(a, b, 0.5, out);
}
export function truncate(vector: Vector3, decimalPlaces: number = 2, out?: Vector3): Vector3 {
const scale = 10 ** Math.max(decimalPlaces, 0);
const x = ~~(vector.x * scale) / scale;
const y = ~~(vector.y * scale) / scale;
const z = ~~(vector.z * scale) / scale;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function clampLength(vector: Vector3, maxLength: number, out?: Vector3): Vector3 {
const lenSq = lengthSquared(vector);
if (lenSq <= maxLength * maxLength) {
if (!out) return { x: vector.x, y: vector.y, z: vector.z };
out.x = vector.x;
out.y = vector.y;
out.z = vector.z;
return out;
}
const scale = maxLength / Math.sqrt(lenSq);
const x = vector.x * scale;
const y = vector.y * scale;
const z = vector.z * scale;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function rotateAroundAxis(vector: Vector3, axis: Vector3, angleRad: number, out?: Vector3): Vector3 {
const cos = Math.cos(angleRad);
const sin = Math.sin(angleRad);
const dotProduct = vector.x * axis.x + vector.y * axis.y + vector.z * axis.z;
const crossX = axis.y * vector.z - axis.z * vector.y;
const crossY = axis.z * vector.x - axis.x * vector.z;
const crossZ = axis.x * vector.y - axis.y * vector.x;
const oneMinusCos = 1 - cos;
const x = vector.x * cos + crossX * sin + axis.x * dotProduct * oneMinusCos;
const y = vector.y * cos + crossY * sin + axis.y * dotProduct * oneMinusCos;
const z = vector.z * cos + crossZ * sin + axis.z * dotProduct * oneMinusCos;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function transformLocalOffset(
origin: Vector3,
forward: Vector3,
localOffset: Vector3,
out?: Vector3
): Vector3 {
const fLen = length(forward);
const fX = fLen > 0 ? forward.x / fLen : 0;
const fY = fLen > 0 ? forward.y / fLen : 0;
const fZ = fLen > 0 ? forward.z / fLen : 1;
const wx = Math.abs(fY) > 0.999 ? 1 : 0;
const wy = Math.abs(fY) > 0.999 ? 0 : 1;
const wz = 0;
let rX = fY * wz - fZ * wy;
let rY = fZ * wx - fX * wz;
let rZ = fX * wy - fY * wx;
const rLen = Math.sqrt(rX * rX + rY * rY + rZ * rZ);
if (rLen > 0) {
rX /= rLen;
rY /= rLen;
rZ /= rLen;
}
const uX = rY * fZ - rZ * fY;
const uY = rZ * fX - rX * fZ;
const uZ = rX * fY - rY * fX;
const x = origin.x + rX * localOffset.x + uX * localOffset.y + fX * localOffset.z;
const y = origin.y + rY * localOffset.x + uY * localOffset.y + fY * localOffset.z;
const z = origin.z + rZ * localOffset.x + uZ * localOffset.y + fZ * localOffset.z;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function rotateYawPitch(forward: Vector3, yawDeg: number, pitchDeg: number, out?: Vector3): Vector3 {
if (yawDeg === 0 && pitchDeg === 0) return normalize(forward, out);
const fLen = length(forward);
const fX = fLen > 0 ? forward.x / fLen : 0;
const fY = fLen > 0 ? forward.y / fLen : 0;
const fZ = fLen > 0 ? forward.z / fLen : 1;
const wx = Math.abs(fY) > 0.999 ? 1 : 0;
const wy = Math.abs(fY) > 0.999 ? 0 : 1;
const wz = 0;
let rX = fY * wz - fZ * wy;
let rY = fZ * wx - fX * wz;
let rZ = fX * wy - fY * wx;
const rLen = Math.sqrt(rX * rX + rY * rY + rZ * rZ);
if (rLen > 0) {
rX /= rLen;
rY /= rLen;
rZ /= rLen;
}
const uX = rY * fZ - rZ * fY;
const uY = rZ * fX - rX * fZ;
const uZ = rX * fY - rY * fX;
const hRad = (yawDeg * Math.PI) / 180;
const vRad = (pitchDeg * Math.PI) / 180;
const cFwd = Math.cos(hRad) * Math.cos(vRad);
const cUp = Math.cos(hRad) * Math.sin(vRad);
const cRight = Math.sin(hRad);
const x = fX * cFwd + uX * cUp + rX * cRight;
const y = fY * cFwd + uY * cUp + rY * cRight;
const z = fZ * cFwd + uZ * cUp + rZ * cRight;
if (!out) return { x, y, z };
out.x = x;
out.y = y;
out.z = z;
return out;
}
export function degreesToRadians(degrees: number): number {
return (degrees * Math.PI) / 180;
}
export function getRotationVector(orientation: number, out?: Vector3): Vector3 {
const y = degreesToRadians(180 - orientation);
if (!out) return { x: 0, y, z: 0 };
out.x = 0;
out.y = y;
out.z = 0;
return out;
}
export function getDirectionFromPlayerRotation(rotation: Vector3, out?: Vector3): Vector3 {
const dest = out ?? { x: 0, y: 0, z: 0 };
const rotX = rotation.x;
const rotY = rotation.y;
const yaw = rotX > 1.5 || rotX < -1.5 ? (rotY >= 0 ? Math.PI - rotY : -Math.PI - rotY) : rotY;
dest.x = Math.sin(yaw);
dest.y = 0;
dest.z = Math.cos(yaw);
return dest;
}
export function getHeadingFromPlayerRotation(rotation: Vector3): number {
const rotX = rotation.x;
const rotY = rotation.y;
const yaw = rotX > 1.5 || rotX < -1.5 ? (rotY >= 0 ? Math.PI - rotY : -Math.PI - rotY) : rotY;
const heading = 180 - (yaw * 180) / Math.PI;
const normalized = ((heading % 360) + 360) % 360;
return normalized === 360 ? 0 : normalized;
}
export function facingToEuler(facing: Vector3, out?: Vector3): Vector3 {
const dest = out ?? { x: 0, y: 0, z: 0 };
const fx = facing.x;
const fy = facing.y;
const fz = facing.z;
const lenSq = fx * fx + fy * fy + fz * fz;
if (lenSq === 0) {
dest.x = 0;
dest.y = 0;
dest.z = 0;
return dest;
}
const invLen = 1 / Math.sqrt(lenSq);
const normY = fy * invLen;
const clampedY = normY > 1 ? 1 : normY < -1 ? -1 : normY;
const horizLenSq = fx * fx + fz * fz;
dest.x = Math.asin(clampedY);
dest.y = horizLenSq === 0 ? 0 : Math.atan2(-fx || 0, -fz || 0);
dest.z = 0;
return dest;
}
export function distanceSquared(a: Vector3, b: Vector3): number {
const dx = a.x - b.x;
const dy = a.y - b.y;
const dz = a.z - b.z;
return dx * dx + dy * dy + dz * dz;
}
export function distance(a: Vector3, b: Vector3): number {
return Math.sqrt(distanceSquared(a, b));
}
export function isVector3(v: unknown): v is Vector3 {
if (v === null || typeof v !== 'object') return false;
const vector = v as Record<string, unknown>;
return typeof vector.x === 'number' && typeof vector.y === 'number' && typeof vector.z === 'number';
}
export function getVectorString(vector: Vector3, precision: number = 2): string {
return `<${vector.x.toFixed(precision)}, ${vector.y.toFixed(precision)}, ${vector.z.toFixed(precision)}>`;
}
}
// --- SOURCE: node_modules\bf6-portal-utils\colors\index.ts ---
export namespace Colors {
export type Color = {
r: number;
g: number;
b: number;
};
export const BLACK: Readonly<Color> = Object.freeze({ r: 0, g: 0, b: 0 });
export const GREY_25: Readonly<Color> = Object.freeze({ r: 0.25, g: 0.25, b: 0.25 });
export const GREY_50: Readonly<Color> = Object.freeze({ r: 0.5, g: 0.5, b: 0.5 });
export const GREY_75: Readonly<Color> = Object.freeze({ r: 0.75, g: 0.75, b: 0.75 });
export const WHITE: Readonly<Color> = Object.freeze({ r: 1, g: 1, b: 1 });
export const RED: Readonly<Color> = Object.freeze({ r: 1, g: 0, b: 0 });
export const GREEN: Readonly<Color> = Object.freeze({ r: 0, g: 1, b: 0 });
export const BLUE: Readonly<Color> = Object.freeze({ r: 0, g: 0, b: 1 });
export const YELLOW: Readonly<Color> = Object.freeze({ r: 1, g: 1, b: 0 });
export const PURPLE: Readonly<Color> = Object.freeze({ r: 1, g: 0, b: 1 });
export const CYAN: Readonly<Color> = Object.freeze({ r: 0, g: 1, b: 1 });
export const MAGENTA: Readonly<Color> = Object.freeze({ r: 1, g: 0, b: 1 });
export const BF_GREY_1: Readonly<Color> = Object.freeze({ r: 0.8353, g: 0.9216, b: 0.9765 });
export const BF_GREY_2: Readonly<Color> = Object.freeze({ r: 0.3294, g: 0.3686, b: 0.3882 });
export const BF_GREY_3: Readonly<Color> = Object.freeze({ r: 0.2118, g: 0.2235, b: 0.2353 });
export const BF_GREY_4: Readonly<Color> = Object.freeze({ r: 0.0314, g: 0.0431, b: 0.0431 });
export const BF_BLUE_BRIGHT: Readonly<Color> = Object.freeze({ r: 0.4392, g: 0.9216, b: 1.0 });
export const BF_BLUE_DARK: Readonly<Color> = Object.freeze({ r: 0.0745, g: 0.1843, b: 0.2471 });
export const BF_RED_BRIGHT: Readonly<Color> = Object.freeze({ r: 1.0, g: 0.5137, b: 0.3804 });
export const BF_RED_DARK: Readonly<Color> = Object.freeze({ r: 0.251, g: 0.0941, b: 0.0667 });
export const BF_GREEN_BRIGHT: Readonly<Color> = Object.freeze({ r: 0.6784, g: 0.9922, b: 0.5255 });
export const BF_GREEN_DARK: Readonly<Color> = Object.freeze({ r: 0.2784, g: 0.4471, b: 0.2118 });
export const BF_YELLOW_BRIGHT: Readonly<Color> = Object.freeze({ r: 1.0, g: 0.9882, b: 0.6118 });
export const BF_YELLOW_DARK: Readonly<Color> = Object.freeze({ r: 0.4431, g: 0.3765, b: 0.0 });
export const PRESETS = Object.freeze({
BLACK,
GREY_25,
GREY_50,
GREY_75,
WHITE,
RED,
GREEN,
BLUE,
YELLOW,
PURPLE,
CYAN,
MAGENTA,
BF_GREY_1,
BF_GREY_2,
BF_GREY_3,
BF_GREY_4,
BF_BLUE_BRIGHT,
BF_BLUE_DARK,
BF_RED_BRIGHT,
BF_RED_DARK,
BF_GREEN_BRIGHT,
BF_GREEN_DARK,
BF_YELLOW_BRIGHT,
BF_YELLOW_DARK,
});
export function set(target: Color, r: number, g: number, b: number): Color {
target.r = r;
target.g = g;
target.b = b;
return target;
}
export function copy(target: Color, source: Color): Color {
target.r = source.r;
target.g = source.g;
target.b = source.b;
return target;
}
export function clone(source: Color): Color {
return { r: source.r, g: source.g, b: source.b };
}
export function equals(a: Color, b: Color, tolerance: number = 0): boolean {
return tolerance === 0
? a.r === b.r && a.g === b.g && a.b === b.b
: Math.abs(a.r - b.r) <= tolerance && Math.abs(a.g - b.g) <= tolerance && Math.abs(a.b - b.b) <= tolerance;
}
export function lerp(a: Color, b: Color, t: number, out?: Color): Color {
const rCh = a.r + (b.r - a.r) * t;
const gCh = a.g + (b.g - a.g) * t;
const bCh = a.b + (b.b - a.b) * t;
if (!out) return { r: rCh, g: gCh, b: bCh };
out.r = rCh;
out.g = gCh;
out.b = bCh;
return out;
}
export function clamp(color: Color, out?: Color): Color {
const r = Math.min(Math.max(color.r, 0), 1);
const g = Math.min(Math.max(color.g, 0), 1);
const b = Math.min(Math.max(color.b, 0), 1);
if (!out) return { r, g, b };
out.r = r;
out.g = g;
out.b = b;
return out;
}
export function add(a: Color, b: Color, out?: Color): Color {
const rCh = a.r + b.r;
const gCh = a.g + b.g;
const bCh = a.b + b.b;
if (!out) return { r: rCh, g: gCh, b: bCh };
out.r = rCh;
out.g = gCh;
out.b = bCh;
return out;
}
export function subtract(a: Color, b: Color, out?: Color): Color {
const rCh = a.r - b.r;
const gCh = a.g - b.g;
const bCh = a.b - b.b;
if (!out) return { r: rCh, g: gCh, b: bCh };
out.r = rCh;
out.g = gCh;
out.b = bCh;
return out;
}
export function multiply(color: Color, scalar: number, out?: Color): Color {
const r = color.r * scalar;
const g = color.g * scalar;
const b = color.b * scalar;
if (!out) return { r, g, b };
out.r = r;
out.g = g;
out.b = b;
return out;
}
export function divide(color: Color, scalar: number, out?: Color): Color {
const r = color.r / scalar;
const g = color.g / scalar;
const b = color.b / scalar;
if (!out) return { r, g, b };
out.r = r;
out.g = g;
out.b = b;
return out;
}
export function tint(a: Color, b: Color, out?: Color): Color {
const rCh = a.r * b.r;
const gCh = a.g * b.g;
const bCh = a.b * b.b;
if (!out) return { r: rCh, g: gCh, b: bCh };
out.r = rCh;
out.g = gCh;
out.b = bCh;
return out;
}
export function luminance(color: Color): number {
return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}
export function fromHex(hex: string, out?: Color): Color {
const cleanHex = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
let r = 1;
let g = 1;
let b = 1;
if (cleanHex.length === 3) {
const rChar = cleanHex.charAt(0);
const gChar = cleanHex.charAt(1);
const bChar = cleanHex.charAt(2);
r = parseInt(rChar + rChar, 16) / 255;
g = parseInt(gChar + gChar, 16) / 255;
b = parseInt(bChar + bChar, 16) / 255;
} else if (cleanHex.length === 6) {
r = parseInt(cleanHex.slice(0, 2), 16) / 255;
g = parseInt(cleanHex.slice(2, 4), 16) / 255;
b = parseInt(cleanHex.slice(4, 6), 16) / 255;
}
if (isNaN(r) || isNaN(g) || isNaN(b)) {
r = 1;
g = 1;
b = 1;
}
if (!out) return { r, g, b };
out.r = r;
out.g = g;
out.b = b;
return out;
}
export function toHex(color: Color): string {
const rInt = Math.min(Math.max(Math.round(color.r * 255), 0), 255);
const gInt = Math.min(Math.max(Math.round(color.g * 255), 0), 255);
const bInt = Math.min(Math.max(Math.round(color.b * 255), 0), 255);
const rHex = rInt < 16 ? '0' + rInt.toString(16) : rInt.toString(16);
const gHex = gInt < 16 ? '0' + gInt.toString(16) : gInt.toString(16);
const bHex = bInt < 16 ? '0' + bInt.toString(16) : bInt.toString(16);
return ('#' + rHex + gHex + bHex).toUpperCase();
}
export function toVector(color: Color): mod.Vector {
return mod.CreateVector(color.r, color.g, color.b);
}
export function fromVector(vector: mod.Vector, out?: Color): Color {
const r = mod.XComponentOf(vector);
const g = mod.YComponentOf(vector);
const b = mod.ZComponentOf(vector);
if (!out) return { r, g, b };
out.r = r;
out.g = g;
out.b = b;
return out;
}
export function toVector3(color: Color, out?: Vectors.Vector3): Vectors.Vector3 {
if (!out) return { x: color.r, y: color.g, z: color.b };
out.x = color.r;
out.y = color.g;
out.z = color.b;
return out;
}
export function fromVector3(vector: Vectors.Vector3, out?: Color): Color {
if (!out) return { r: vector.x, g: vector.y, b: vector.z };
out.r = vector.x;
out.g = vector.y;
out.b = vector.z;
return out;
}
}
// --- SOURCE: node_modules\bf6-portal-utils\ui\index.ts ---
export namespace UI {
export type Color = Colors.Color;
const logging = new Logging('UI');
export const LogLevel = Logging.LogLevel;
export function setLogging(
log?: (text: string, error?: unknown) => Promise<void> | void,
logLevel?: Logging.LogLevel,
includeRawError?: boolean
): void {
logging.setLogging(log, logLevel, includeRawError);
}
const ROOT_NODE_ID = 0;
const INVALID_INDEX = -1;
const GENERATION_MULTIPLIER = 10000;
const MAX_GENERATION = 65535;
export const MAX_ELEMENTS = 2048;
export function getActiveElementCount(): number {
return _activeElementCount;
}
const FLAG_IN_USE = 1 << 0;
const FLAG_VISIBLE = 1 << 1;
const FLAG_HAS_INPUT_MODE = 1 << 2;
const FLAG_UI_INPUT_MODE_WHEN_VISIBLE = 1 << 3;
const DEPTH_SHIFT = 4;
const DEPTH_MASK = 0x1;
const BG_FILL_SHIFT = 5;
const BG_FILL_MASK = 0xf;
const ANCHOR_SHIFT = 9;
const ANCHOR_MASK = 0xf;
const FLAG_ENABLED = 1 << 13;
const RECEIVER_GLOBAL = 164;
const RECEIVER_TEAM_OFFSET = 100;
export const ZERO_VECTOR: mod.Vector = mod.CreateVector(0, 0, 0);
const DIRTY_POSITION = 1 << 0;
const DIRTY_SIZE = 1 << 1;
const DIRTY_BG_COLOR = 1 << 2;
const DIRTY_BG_ALPHA = 1 << 3;
const DIRTY_BG_FILL = 1 << 4;
const DIRTY_DEPTH = 1 << 5;
const DIRTY_ANCHOR = 1 << 6;
const DIRTY_VISIBLE = 1 << 7;
const DIRTY_PARENT = 1 << 8;
const DIRTY_PADDING = 1 << 9;
const DIRTY_FOREGROUND_COLOR = 1 << 10;
const DIRTY_FOREGROUND_ALPHA = 1 << 11;
const UNUSED_DIRTY_OFFSET = 12;
const _flags = new Uint16Array(MAX_ELEMENTS);
const _generations = new Uint16Array(MAX_ELEMENTS);
const _parents = new Int16Array(MAX_ELEMENTS);
const _firstChild = new Int16Array(MAX_ELEMENTS);
const _nextSibling = new Int16Array(MAX_ELEMENTS);
const _x = new Float32Array(MAX_ELEMENTS);
const _y = new Float32Array(MAX_ELEMENTS);
const _width = new Float32Array(MAX_ELEMENTS);
const _height = new Float32Array(MAX_ELEMENTS);
const _bgRgba = new Uint32Array(MAX_ELEMENTS);
const _foregroundRgba = new Uint32Array(MAX_ELEMENTS);
const _padding = new Float32Array(MAX_ELEMENTS);
const _dirtyFlags = new Uint32Array(MAX_ELEMENTS);
const _dirtySlots = new Uint16Array(MAX_ELEMENTS);
let _dirtyCount = 0;
const _nativeWidgets = new Array<mod.UIWidget | null>(MAX_ELEMENTS);
const _instances = new Array<Element | null>(MAX_ELEMENTS);
const _elementToCustomSlot = new Int16Array(MAX_ELEMENTS);
_elementToCustomSlot.fill(INVALID_INDEX);
const _receiverIds = new Uint8Array(MAX_ELEMENTS);
for (let i = 0; i < MAX_ELEMENTS - 1; ++i) {
_nextSibling[i] = i + 1;
}
_nextSibling[MAX_ELEMENTS - 1] = INVALID_INDEX;
_parents.fill(INVALID_INDEX);
_firstChild.fill(INVALID_INDEX);
_nativeWidgets.fill(null);
_receiverIds.fill(RECEIVER_GLOBAL);
_instances.fill(null);
let _firstFree = 0;
let _firstRoot = INVALID_INDEX;
let _activeElementCount = 0;
let _rootNativeWidget: mod.UIWidget | null = null;
function _getRootNativeWidget(): mod.UIWidget {
if (!_rootNativeWidget) {
_rootNativeWidget = mod.GetUIRoot();
}
return _rootNativeWidget;
}
function _hasFlag(slot: number, flag: number): boolean {
return (_flags[slot] & flag) !== 0;
}
function _setFlag(slot: number, flag: number): void {
_flags[slot] |= flag;
}
function _clearFlag(slot: number, flag: number): void {
_flags[slot] &= ~flag;
}
function _isInUse(slot: number): boolean {
return _hasFlag(slot, FLAG_IN_USE);
}
function _isVisible(slot: number): boolean {
return _hasFlag(slot, FLAG_VISIBLE);
}
function _hasInputMode(slot: number): boolean {
return _hasFlag(slot, FLAG_HAS_INPUT_MODE);
}
function _isUIInputModeWhenVisible(slot: number): boolean {
return _hasFlag(slot, FLAG_UI_INPUT_MODE_WHEN_VISIBLE);
}
const _NATIVE_ANCHORS: readonly mod.UIAnchor[] = [
mod.UIAnchor.TopLeft,
mod.UIAnchor.TopCenter,
mod.UIAnchor.TopRight,
mod.UIAnchor.CenterLeft,
mod.UIAnchor.Center,
mod.UIAnchor.CenterRight,
mod.UIAnchor.BottomLeft,
mod.UIAnchor.BottomCenter,
mod.UIAnchor.BottomRight,
];
const _NATIVE_BG_FILLS: readonly mod.UIBgFill[] = [
mod.UIBgFill.None,
mod.UIBgFill.Solid,
mod.UIBgFill.Blur,
mod.UIBgFill.GradientBottom,
mod.UIBgFill.GradientLeft,
mod.UIBgFill.GradientRight,
mod.UIBgFill.GradientTop,
mod.UIBgFill.OutlineThick,
mod.UIBgFill.OutlineThin,
];
const _NATIVE_DEPTHS: readonly mod.UIDepth[] = [mod.UIDepth.AboveGameUI, mod.UIDepth.BelowGameUI];
const _NATIVE_IMAGE_TYPES: readonly mod.UIImageType[] = [
mod.UIImageType.None,
mod.UIImageType.CrownOutline,
mod.UIImageType.CrownSolid,
mod.UIImageType.QuestionMark,
mod.UIImageType.RifleAmmo,
mod.UIImageType.SelfHeal,
mod.UIImageType.SpawnBeacon,
mod.UIImageType.TEMP_PortalIcon,
];
function _setAnchor(slot: number, anchor: Anchor): void {
_flags[slot] = (_flags[slot] & ~(ANCHOR_MASK << ANCHOR_SHIFT)) | ((anchor & ANCHOR_MASK) << ANCHOR_SHIFT);
}
function _getAnchor(slot: number): Anchor {
return ((_flags[slot] >>> ANCHOR_SHIFT) & ANCHOR_MASK) as Anchor;
}
function _setBgFill(slot: number, fill: BgFill): void {
_flags[slot] = (_flags[slot] & ~(BG_FILL_MASK << BG_FILL_SHIFT)) | ((fill & BG_FILL_MASK) << BG_FILL_SHIFT);
}
function _getBgFill(slot: number): BgFill {
return ((_flags[slot] >>> BG_FILL_SHIFT) & BG_FILL_MASK) as BgFill;
}
function _setDepth(slot: number, depth: Depth): void {
_flags[slot] = (_flags[slot] & ~(DEPTH_MASK << DEPTH_SHIFT)) | ((depth & DEPTH_MASK) << DEPTH_SHIFT);
}
function _getDepth(slot: number): Depth {
return ((_flags[slot] >>> DEPTH_SHIFT) & DEPTH_MASK) as Depth;
}
function _setBgColor(slot: number, color: Colors.Color): void {
const rInt = Math.min(Math.max(Math.round(color.r * 255), 0), 255);
const gInt = Math.min(Math.max(Math.round(color.g * 255), 0), 255);
const bInt = Math.min(Math.max(Math.round(color.b * 255), 0), 255);
const aInt = _bgRgba[slot] & 0xff;
_bgRgba[slot] = ((rInt << 24) | (gInt << 16) | (bInt << 8) | aInt) >>> 0;
}
function _setBgAlpha(slot: number, alpha: number): void {
const aInt = Math.min(Math.max(Math.round(alpha * 255), 0), 255);
_bgRgba[slot] = ((_bgRgba[slot] & ~0xff) | aInt) >>> 0;
}
function _getBgColor(slot: number, out?: Colors.Color): Colors.Color {
const rgba = _bgRgba[slot];
const r = (rgba >>> 24) / 255;
const g = ((rgba >>> 16) & 0xff) / 255;
const b = ((rgba >>> 8) & 0xff) / 255;
if (out) {
out.r = r;
out.g = g;
out.b = b;
return out;
}
return { r, g, b };
}
function _getBgAlpha(slot: number): number {
return (_bgRgba[slot] & 0xff) / 255;
}
function _setForegroundColor(slot: number, color: Colors.Color): boolean {
const rInt = Math.min(Math.max(Math.round(color.r * 255), 0), 255);
const gInt = Math.min(Math.max(Math.round(color.g * 255), 0), 255);
const bInt = Math.min(Math.max(Math.round(color.b * 255), 0), 255);
const currentRgba = _foregroundRgba[slot];
const newRgba = ((rInt << 24) | (gInt << 16) | (bInt << 8) | (currentRgba & 0xff)) >>> 0;
if (newRgba === currentRgba) return false;
_foregroundRgba[slot] = newRgba;
return true;
}
function _setForegroundAlpha(slot: number, alpha: number): boolean {
const aInt = Math.min(Math.max(Math.round(alpha * 255), 0), 255);
const currentRgba = _foregroundRgba[slot];
if ((currentRgba & 0xff) === aInt) return false;
_foregroundRgba[slot] = ((currentRgba & ~0xff) | aInt) >>> 0;
return true;
}
function _markDirty(slot: number, flag: number): void {
if (slot < 0 || slot >= MAX_ELEMENTS) return;
if (_dirtyFlags[slot] === 0) {
_dirtySlots[_dirtyCount++] = slot;
}
_dirtyFlags[slot] |= flag;
}
export function flush(): void {
const count = _dirtyCount;
if (count === 0) return;
_dirtyCount = 0;
for (let i = 0; i < count; ++i) {
const slot = _dirtySlots[i];
const flags = _dirtyFlags[slot];
if (flags === 0) continue;
_dirtyFlags[slot] = 0;
const widget = _nativeWidgets[slot];
if (!widget || !_isInUse(slot)) continue;
if (flags & DIRTY_PARENT) {
const parentSlot = _parents[slot];
const parentWidget = parentSlot === INVALID_INDEX ? _getRootNativeWidget() : _nativeWidgets[parentSlot];
if (parentWidget) {
mod.SetUIWidgetParent(widget, parentWidget);
}
}
if (flags & DIRTY_POSITION) {
mod.SetUIWidgetPosition(widget, mod.CreateVector(_x[slot], _y[slot], 0));
}
if (flags & DIRTY_SIZE) {
mod.SetUIWidgetSize(widget, mod.CreateVector(_width[slot], _height[slot], 0));
}
if (flags & DIRTY_ANCHOR) {
mod.SetUIWidgetAnchor(widget, _NATIVE_ANCHORS[_getAnchor(slot)]);
}
if (flags & DIRTY_DEPTH) {
mod.SetUIWidgetDepth(widget, _NATIVE_DEPTHS[_getDepth(slot)]);
}
if (flags & DIRTY_BG_FILL) {
mod.SetUIWidgetBgFill(widget, _NATIVE_BG_FILLS[_getBgFill(slot)]);
}
if (flags & DIRTY_BG_COLOR) {
const rgba = _bgRgba[slot];
const r = (rgba >>> 24) / 255;
const g = ((rgba >>> 16) & 0xff) / 255;
const b = ((rgba >>> 8) & 0xff) / 255;
mod.SetUIWidgetBgColor(widget, mod.CreateVector(r, g, b));
}
if (flags & DIRTY_BG_ALPHA) {
mod.SetUIWidgetBgAlpha(widget, (_bgRgba[slot] & 0xff) / 255);
}
if (flags & DIRTY_PADDING) {
mod.SetUIWidgetPadding(widget, _padding[slot]);
}
if (flags & DIRTY_VISIBLE) {
mod.SetUIWidgetVisible(widget, _isVisible(slot));
}
const inst = _instances[slot];
if (inst) {
(inst as unknown as { _handleFlush(f: number, w: mod.UIWidget): void })._handleFlush(flags, widget);
}
}
}
function _getForegroundColor(slot: number, out?: Colors.Color): Colors.Color {
const rgba = _foregroundRgba[slot];
const r = (rgba >>> 24) / 255;
const g = ((rgba >>> 16) & 0xff) / 255;
const b = ((rgba >>> 8) & 0xff) / 255;
if (out) {
out.r = r;
out.g = g;
out.b = b;
return out;
}
return { r, g, b };
}
function _getForegroundAlpha(slot: number): number {
return (_foregroundRgba[slot] & 0xff) / 255;
}
function _encodeId(slot: number): number {
return slot + 1 + GENERATION_MULTIPLIER * _generations[slot];
}
function _resolveSlot(id: number): number {
if (id <= 0) return INVALID_INDEX;
const slot = (id % GENERATION_MULTIPLIER) - 1;
if (slot < 0 || slot >= MAX_ELEMENTS) return INVALID_INDEX;
const idGen = Math.floor(id / GENERATION_MULTIPLIER);
if (_generations[slot] !== idGen || !_isInUse(slot)) return INVALID_INDEX;
return slot;
}
function _resolveSlotAndLogWarning(id: number): number {
if (id <= 0) return INVALID_INDEX;
const slot = (id % GENERATION_MULTIPLIER) - 1;
if (slot < 0 || slot >= MAX_ELEMENTS) return INVALID_INDEX;
const idGen = Math.floor(id / GENERATION_MULTIPLIER);
const gen = _generations[slot];
if (idGen < gen) {
logging.log('Element is deleted', LogLevel.Warning);
return INVALID_INDEX;
}
if (gen !== idGen || !_isInUse(slot)) return INVALID_INDEX;
return slot;
}
function isDeleted(id: number): boolean | undefined {
if (id === ROOT_NODE_ID) return false;
if (id <= 0) return undefined;
const slot = (id % GENERATION_MULTIPLIER) - 1;
if (slot < 0 || slot >= MAX_ELEMENTS) return undefined;
const idGen = Math.floor(id / GENERATION_MULTIPLIER);
const gen = _generations[slot];
if (idGen > gen) return undefined;
if (idGen < gen) return true;
return _isInUse(slot) ? false : undefined;
}
function isValid(id: number): boolean {
return id === ROOT_NODE_ID || _resolveSlot(id) !== INVALID_INDEX;
}
function _allocateSlot(): number {
if (_firstFree === INVALID_INDEX) {
logging.log('Element pool is full', LogLevel.Error);
return INVALID_INDEX;
}
const slot = _firstFree;
_firstFree = _nextSibling[slot];
_nextSibling[slot] = INVALID_INDEX;
_firstChild[slot] = INVALID_INDEX;
_parents[slot] = INVALID_INDEX;
_flags[slot] = FLAG_IN_USE;
_activeElementCount++;
return slot;
}
function _freeSlot(slot: number): void {
_flags[slot] = 0;
_bgRgba[slot] = 0;
_foregroundRgba[slot] = 0;
_nativeWidgets[slot] = null;
_receiverIds[slot] = RECEIVER_GLOBAL;
_instances[slot] = null;
_elementToCustomSlot[slot] = INVALID_INDEX;
_parents[slot] = INVALID_INDEX;
_firstChild[slot] = INVALID_INDEX;
_x[slot] = 0;
_y[slot] = 0;
_width[slot] = 0;
_height[slot] = 0;
_padding[slot] = 0;
_dirtyFlags[slot] = 0;
_activeElementCount--;
if (_generations[slot] < MAX_GENERATION) {
_generations[slot]++;
_nextSibling[slot] = _firstFree;
_firstFree = slot;
} else if (logging.willLog(LogLevel.Warning)) {
logging.log(`Slot ${slot} exhausted max generations and was retired`, LogLevel.Warning);
}
}
function _attachChild(parentSlot: number, childSlot: number): void {
_parents[childSlot] = parentSlot;
if (parentSlot === INVALID_INDEX) {
_nextSibling[childSlot] = _firstRoot;
_firstRoot = childSlot;
return;
}
_nextSibling[childSlot] = _firstChild[parentSlot];
_firstChild[parentSlot] = childSlot;
}
function _detachChild(parentSlot: number, childSlot: number): void {
const head = parentSlot === INVALID_INDEX ? _firstRoot : _firstChild[parentSlot];
if (head === childSlot) {
if (parentSlot === INVALID_INDEX) {
_firstRoot = _nextSibling[childSlot];
} else {
_firstChild[parentSlot] = _nextSibling[childSlot];
}
} else {
let curr = head;
while (curr !== INVALID_INDEX && _nextSibling[curr] !== childSlot) {
curr = _nextSibling[curr];
}
if (curr !== INVALID_INDEX) {
_nextSibling[curr] = _nextSibling[childSlot];
}
}
_parents[childSlot] = INVALID_INDEX;
_nextSibling[childSlot] = INVALID_INDEX;
}
function _resolveNodeSlotAndLogWarning(target?: Parent | number | null): number {
if (!target) return INVALID_INDEX;
const id = typeof target === 'number' ? target : Node._getId(target);
return id === ROOT_NODE_ID ? INVALID_INDEX : _resolveSlotAndLogWarning(id);
}
function _resolveNodeSlot(target?: Parent | number | null): number {
if (!target) return INVALID_INDEX;
const id = typeof target === 'number' ? target : Node._getId(target);
return id === ROOT_NODE_ID ? INVALID_INDEX : _resolveSlot(id);
}
function isTeam(receiver?: mod.Player | mod.Team): receiver is mod.Team {
return receiver !== undefined && mod.IsType(receiver, mod.Types.Team);
}
function isPlayer(receiver?: mod.Player | mod.Team): receiver is mod.Player {
return receiver !== undefined && mod.IsType(receiver, mod.Types.Player);
}
export enum Anchor {
TopLeft = 0,
TopCenter = 1,
TopRight = 2,
CenterLeft = 3,
Center = 4,
CenterRight = 5,
BottomLeft = 6,
BottomCenter = 7,
BottomRight = 8,
}
export enum BgFill {
None = 0,
Solid = 1,
Blur = 2,
GradientBottom = 3,
GradientLeft = 4,
GradientRight = 5,
GradientTop = 6,
OutlineThick = 7,
OutlineThin = 8,
}
export enum Depth {
AboveGameUI = 0,
BelowGameUI = 1,
}
export enum ImageType {
None = 0,
CrownOutline = 1,
CrownSolid = 2,
QuestionMark = 3,
RifleAmmo = 4,
SelfHeal = 5,
SpawnBeacon = 6,
TEMP_PortalIcon = 7,
}
export type ButtonHandler = (player: mod.Player) => Promise<void> | void;
export interface Parent extends Node {
readonly receiver: mod.Player | mod.Team | null | undefined;
readonly parent: Parent | null | undefined;
readonly children: readonly Element[] | undefined;
readonly childCount: number | undefined;
getChild(index: number): Element | null | undefined;
forEachChild(callback: (child: Element, index: number) => void): void;
}
type BaseParams = {
anchor?: Anchor;
parent?: Parent;
visible?: boolean;
bgColor?: Colors.Color;
bgAlpha?: number;
bgFill?: BgFill;
depth?: Depth;
receiver?: mod.Player | mod.Team;
uiInputModeWhenVisible?: boolean;
};
export type Size = {
width: number;
height: number;
};
export type Position = {
x: number;
y: number;
};
type EitherPosition =
| ({ position?: Position } & { x?: never; y?: never })
| ({ x?: number; y?: number } & { position?: never });
type EitherSize =
| ({ size?: Size } & { width?: never; height?: never })
| ({ width?: number; height?: number } & { size?: never });
export type ElementParams = BaseParams & EitherPosition & EitherSize;
abstract class Receiver<T extends mod.Player | mod.Team | undefined> {
protected _nativeReceiver: T;
protected _inputModeRequesterCount: number = 0;
protected constructor(receiver: T) {
this._nativeReceiver = receiver;
}
public get nativeReceiver(): T {
return this._nativeReceiver;
}
public get isInputModeRequested(): boolean {
return this._inputModeRequesterCount > 0;
}
public addInputModeRequester(): void {
if (++this._inputModeRequesterCount !== 1) return;
if (this._nativeReceiver) {
mod.EnableUIInputMode(true, this._nativeReceiver);
} else {
mod.EnableUIInputMode(true);
}
}
public removeInputModeRequester(): void {
if (this._inputModeRequesterCount <= 0 || --this._inputModeRequesterCount !== 0) return;
if (this._nativeReceiver) {
mod.EnableUIInputMode(false, this._nativeReceiver);
} else {
mod.EnableUIInputMode(false);
}
}
}
class GlobalReceiver extends Receiver<undefined> {
public constructor() {
super(undefined);
}
}
const _globalReceiver = new GlobalReceiver();
class TeamReceiver extends Receiver<mod.Team> {
private static readonly _instances = new Array<TeamReceiver | null>(64).fill(null);
public static getInstance(receiver: mod.Team): TeamReceiver {
const id = mod.GetObjId(receiver);
const existing = TeamReceiver._instances[id];
if (existing && mod.Equals(existing.nativeReceiver, receiver)) return existing;
return (TeamReceiver._instances[id] = new TeamReceiver(receiver));
}
public static clear(id: number): void {
TeamReceiver._instances[id] = null;
}
public static getById(id: number): TeamReceiver | null {
return TeamReceiver._instances[id] ?? null;
}
private constructor(receiver: mod.Team) {
super(receiver);
}
}
class PlayerReceiver extends Receiver<mod.Player> {
private static readonly _instances = new Array<PlayerReceiver | null>(100).fill(null);
public static getInstance(receiver: mod.Player): PlayerReceiver {
const id = mod.GetObjId(receiver);
const existing = PlayerReceiver._instances[id];
if (existing && mod.Equals(existing.nativeReceiver, receiver)) return existing;
return (PlayerReceiver._instances[id] = new PlayerReceiver(receiver));
}
public static clear(id: number): void {
PlayerReceiver._instances[id] = null;
}
public static getById(id: number): PlayerReceiver | null {
return PlayerReceiver._instances[id] ?? null;
}
private constructor(receiver: mod.Player) {
super(receiver);
}
}
function _getReceiver(slot: number): Receiver<mod.Player | mod.Team | undefined> {
const id = _receiverIds[slot];
if (id === RECEIVER_GLOBAL) return _globalReceiver;
if (id >= RECEIVER_TEAM_OFFSET) return TeamReceiver.getById(id - RECEIVER_TEAM_OFFSET) ?? _globalReceiver;
return PlayerReceiver.getById(id) ?? _globalReceiver;
}
function _encodeReceiver(receiver: Receiver<mod.Player | mod.Team | undefined>): number {
if (receiver instanceof PlayerReceiver) return mod.GetObjId(receiver.nativeReceiver);
if (receiver instanceof TeamReceiver) return RECEIVER_TEAM_OFFSET + mod.GetObjId(receiver.nativeReceiver);
return RECEIVER_GLOBAL;
}
export abstract class Node {
protected static readonly _ROOT_NODE_ID = ROOT_NODE_ID;
protected static readonly _INVALID_INDEX = INVALID_INDEX;
protected static readonly _logging: Logging = logging;
public static _getId(node: Node): number {
return node._id;
}
protected _id: number;
public constructor(id: number) {
this._id = id;
}
public get id(): number {
return this._id;
}
public get isValid(): boolean {
return isValid(this._id);
}
public get isDeleted(): boolean | undefined {
return isDeleted(this._id);
}
protected get _uiWidget(): mod.UIWidget {
if (this._id === ROOT_NODE_ID) return _getRootNativeWidget();
const slot = _resolveSlot(this._id);
return (slot !== INVALID_INDEX ? _nativeWidgets[slot] : undefined)!;
}
public get receiver(): mod.Player | mod.Team | null | undefined {
if (this._id === ROOT_NODE_ID) return null;
const slot = _resolveSlot(this._id);
if (slot === INVALID_INDEX) return undefined;
return _getReceiver(slot).nativeReceiver ?? null;
}
}
export class Root extends Node implements Parent {
public constructor() {
super(ROOT_NODE_ID);
}
protected override get _uiWidget(): mod.UIWidget {
return _getRootNativeWidget();
}
public override get receiver(): null {
return null;
}
public get parent(): null {
return null;
}
public get children(): readonly Element[] {
const list: Element[] = [];
let curr = _firstRoot;
while (curr !== INVALID_INDEX) {
const inst = _instances[curr];
if (inst) {
list.push(inst);
}
curr = _nextSibling[curr];
}
return list;
}
public getChild(index: number): Element | null {
if (index < 0) return null;
let curr = _firstRoot;
let idx = 0;
while (curr !== INVALID_INDEX) {
if (idx === index) return _instances[curr] ?? null;
curr = _nextSibling[curr];
idx++;
}
return null;
}
public get childCount(): number {
let count = 0;
let curr = _firstRoot;
while (curr !== INVALID_INDEX) {
count++;
curr = _nextSibling[curr];
}
return count;
}
public forEachChild(callback: (child: Element, index: number) => void): void {
let curr = _firstRoot;
let idx = 0;
while (curr !== INVALID_INDEX) {
const next = _nextSibling[curr];
const inst = _instances[curr];
if (inst) {
CallbackHandler.invoke(callback, inst, idx++, undefined, undefined, logging, 'forEachChild');
}
curr = next;
}
}
}
export const ROOT_NODE: Root = new Root();
export abstract class Element extends Node {
protected static readonly _ROOT_NODE_ID = ROOT_NODE_ID;
protected static readonly _INVALID_INDEX = INVALID_INDEX;
protected static readonly _elementToCustomSlot: Int16Array = _elementToCustomSlot;
protected static readonly _DIRTY_POSITION = DIRTY_POSITION;
protected static readonly _DIRTY_SIZE = DIRTY_SIZE;
protected static readonly _DIRTY_BG_COLOR = DIRTY_BG_COLOR;
protected static readonly _DIRTY_BG_ALPHA = DIRTY_BG_ALPHA;
protected static readonly _DIRTY_BG_FILL = DIRTY_BG_FILL;
protected static readonly _DIRTY_DEPTH = DIRTY_DEPTH;
protected static readonly _DIRTY_ANCHOR = DIRTY_ANCHOR;
protected static readonly _DIRTY_VISIBLE = DIRTY_VISIBLE;
protected static readonly _DIRTY_PARENT = DIRTY_PARENT;
protected static readonly _DIRTY_PADDING = DIRTY_PADDING;
protected static readonly _DIRTY_FOREGROUND_COLOR = DIRTY_FOREGROUND_COLOR;
protected static readonly _DIRTY_FOREGROUND_ALPHA = DIRTY_FOREGROUND_ALPHA;
protected static readonly _UNUSED_DIRTY_OFFSET: number = UNUSED_DIRTY_OFFSET;
protected static readonly _scratchPos: Position = { x: 0, y: 0 };
protected static readonly _scratchSize: Size = { width: 0, height: 0 };
protected static _isEnabled(slot: number): boolean {
return _hasFlag(slot, FLAG_ENABLED);
}
protected static _setEnabled(slot: number, enabled: boolean): void {
if (enabled) {
_setFlag(slot, FLAG_ENABLED);
} else {
_clearFlag(slot, FLAG_ENABLED);
}
}
protected static _getNativeAnchor(anchor: Anchor): mod.UIAnchor {
return _NATIVE_ANCHORS[anchor];
}
protected static _getNativeBgFill(bgFill: BgFill): mod.UIBgFill {
return _NATIVE_BG_FILLS[bgFill];
}
protected static _getNativeDepth(depth: Depth): mod.UIDepth {
return _NATIVE_DEPTHS[depth];
}
protected static _getNativeImageType(imageType: ImageType): mod.UIImageType {
return _NATIVE_IMAGE_TYPES[imageType];
}
protected static _resolveSlot(id: number): number {
return _resolveSlot(id);
}
protected static _markDirty(slot: number, flag: number): void {
_markDirty(slot, flag);
}
protected static _getPadding(slot: number): number {
return slot >= 0 && slot < MAX_ELEMENTS ? _padding[slot] : 0;
}
protected static _setPadding(slot: number, padding: number): void {
if (slot >= 0 && slot < MAX_ELEMENTS) {
_padding[slot] = padding;
}
}
protected static _getWidth(slot: number): number {
return slot >= 0 && slot < MAX_ELEMENTS ? _width[slot] : 0;
}
protected static _getHeight(slot: number): number {
return slot >= 0 && slot < MAX_ELEMENTS ? _height[slot] : 0;
}
protected static _encodeId(slot: number): number {
return _encodeId(slot);
}
protected static _setForegroundColor(slot: number, color: Colors.Color): boolean {
return _setForegroundColor(slot, color);
}
protected static _setForegroundAlpha(slot: number, alpha: number): boolean {
return _setForegroundAlpha(slot, alpha);
}
protected static _getForegroundColor(slot: number, out?: Colors.Color): Colors.Color {
return _getForegroundColor(slot, out);
}
protected static _getForegroundAlpha(slot: number): number {
return _getForegroundAlpha(slot);
}
protected static _setBgFill(slot: number, fill: BgFill): void {
_setBgFill(slot, fill);
}
protected static _setBgColor(slot: number, color: Colors.Color): void {
_setBgColor(slot, color);
}
protected static _setBgAlpha(slot: number, alpha: number): void {
_setBgAlpha(slot, alpha);
}
protected static _getBgFill(slot: number): BgFill {
return _getBgFill(slot);
}
protected static _getBgAlpha(slot: number): number {
return _getBgAlpha(slot);
}
protected static _getBgColor(slot: number, out?: Colors.Color): Colors.Color {
return _getBgColor(slot, out);
}
protected static _getNextSibling(slot: number): number {
return slot >= 0 && slot < MAX_ELEMENTS ? _nextSibling[slot] : INVALID_INDEX;
}
protected static _getInstance(slot: number): Element | undefined {
return slot >= 0 && slot < MAX_ELEMENTS ? (_instances[slot] ?? undefined) : undefined;
}
protected static _getNativeWidget(target: Parent | Node | number): mod.UIWidget | undefined {
const id = typeof target === 'number' ? target : Node._getId(target);
if (id === ROOT_NODE_ID) return _getRootNativeWidget();
const slot = _resolveSlot(id);
return slot >= 0 && slot < MAX_ELEMENTS ? (_nativeWidgets[slot] ?? undefined) : undefined;
}
protected static _getPosition(params: ElementParams, out?: Position): Position {
const target = out ?? Element._scratchPos;
target.x = params.x ?? params.position?.x ?? 0;
target.y = params.y ?? params.position?.y ?? 0;
return target;
}
protected static _getSize(params: ElementParams, out?: Size): Size {
const target = out ?? Element._scratchSize;
target.width = params.width ?? params.size?.width ?? 0;
target.height = params.height ?? params.size?.height ?? 0;
return target;
}
protected static _getReceiver(
parent: Parent,
receiverParam?: mod.Player | mod.Team
): Receiver<mod.Player | mod.Team | undefined> {
const parentSlot = _resolveNodeSlot(parent);
if (!receiverParam) {
return (parentSlot !== INVALID_INDEX ? _getReceiver(parentSlot) : undefined) ?? _globalReceiver;
}
const parentReceiver = parentSlot !== INVALID_INDEX ? _getReceiver(parentSlot) : undefined;
if (isTeam(receiverParam)) {
const receiver = TeamReceiver.getInstance(receiverParam);
if (parentReceiver instanceof TeamReceiver && parentReceiver !== receiver) {
logging.log('Team receiver mismatch with parent', LogLevel.Warning);
}
if (parentReceiver instanceof PlayerReceiver) {
logging.log('Parent receiver scope is more narrow', LogLevel.Warning);
}
return receiver;
}
if (isPlayer(receiverParam)) {
const receiver = PlayerReceiver.getInstance(receiverParam);
if (parentReceiver instanceof PlayerReceiver && parentReceiver !== receiver) {
logging.log('Player receiver mismatch with parent', LogLevel.Warning);
}
if (
parentReceiver instanceof TeamReceiver &&
parentReceiver.nativeReceiver &&
!mod.Equals(parentReceiver.nativeReceiver, mod.GetTeam(receiverParam))
) {
logging.log('Parent receiver is different team', LogLevel.Warning);
}
return receiver;
}
return _globalReceiver;
}
protected constructor(params?: ElementParams) {
if (!params || (params.parent && !params.parent.isValid)) {
super(INVALID_INDEX);
return;
}
const slot = _allocateSlot();
if (slot === INVALID_INDEX) {
super(INVALID_INDEX);
return;
}
super(_encodeId(slot));
const parent = params.parent ?? ROOT_NODE;
const receiver = Element._getReceiver(parent, params.receiver);
const { x, y } = Element._getPosition(params);
const { width, height } = Element._getSize(params);
const visible = params.visible ?? true;
const uiInputModeWhenVisible = params.uiInputModeWhenVisible ?? false;
const anchor = params.anchor ?? Anchor.Center;
const bgFill = params.bgFill ?? BgFill.None;
const depth = params.depth ?? Depth.AboveGameUI;
const bgColor = params.bgColor ?? Colors.WHITE;
const bgAlpha = params.bgAlpha ?? 0;
_receiverIds[slot] = _encodeReceiver(receiver);
_instances[slot] = this;
_x[slot] = x;
_y[slot] = y;
_width[slot] = width;
_height[slot] = height;
let flags = FLAG_IN_USE | FLAG_ENABLED;
flags |= (depth & DEPTH_MASK) << DEPTH_SHIFT;
flags |= (bgFill & BG_FILL_MASK) << BG_FILL_SHIFT;
flags |= (anchor & ANCHOR_MASK) << ANCHOR_SHIFT;
if (visible) {
flags |= FLAG_VISIBLE;
}
if (uiInputModeWhenVisible) {
flags |= FLAG_UI_INPUT_MODE_WHEN_VISIBLE;
}
if (uiInputModeWhenVisible && visible) {
flags |= FLAG_HAS_INPUT_MODE;
receiver.addInputModeRequester();
}
_flags[slot] = flags;
_setBgAlpha(slot, bgAlpha);
_setBgColor(slot, bgColor);
_attachChild(_resolveNodeSlotAndLogWarning(parent), slot);
}
protected get _slot(): number {
return this._id === ROOT_NODE_ID ? INVALID_INDEX : _resolveSlot(this._id);
}
protected get _isValid(): boolean {
return this._slot !== INVALID_INDEX;
}
protected _getSlotAndLogWarning(): number {
return _resolveSlotAndLogWarning(this._id);
}
protected _getIsInvalidAndLogWarning(): boolean {
if (this._slot === INVALID_INDEX) {
logging.log(`Element is deleted`, LogLevel.Warning);
return true;
}
return false;
}
protected get _receiver(): Receiver<mod.Player | mod.Team | undefined> | undefined {
return this._slot !== INVALID_INDEX ? _getReceiver(this._slot) : undefined;
}
protected get _firstChild(): number {
if (this._id === ROOT_NODE_ID) return _firstRoot;
const slot = this._slot;
return slot >= 0 && slot < MAX_ELEMENTS ? _firstChild[slot] : INVALID_INDEX;
}
protected get _name(): string {
return `ui_${this._id}`;
}
protected _bindNativeWidget(nameOrWidget: string | mod.UIWidget): void {
const slot = this._slot;
if (slot < 0 || slot >= MAX_ELEMENTS) return;
if (typeof nameOrWidget === 'string') {
_nativeWidgets[slot] = mod.FindUIWidgetWithName(nameOrWidget) as mod.UIWidget;
} else {
_nativeWidgets[slot] = nameOrWidget;
}
}
protected _handleFlush(flags: number, widget: mod.UIWidget): void {
}
public get parent(): Parent | undefined {
const slot = this._slot;
if (slot === INVALID_INDEX) return undefined;
const parentSlot = _parents[slot];
if (parentSlot === INVALID_INDEX) return ROOT_NODE;
return (_instances[parentSlot] as (Element & Parent) | null) ?? ROOT_NODE;
}
public set parent(parent: Parent) {
this.setParent(parent);
}
public setParent(parent: Parent): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
const parentId = Node._getId(parent);
if (parentId === this._id) return this;
let ancestor: Parent | null | undefined = parent;
while (ancestor) {
if (Node._getId(ancestor) === this._id) {
logging.log('Cannot create circular parent-child hierarchy', LogLevel.Warning);
return this;
}
ancestor = ancestor.parent;
}
const oldParentSlot = _parents[slot];
const newParentSlot = _resolveNodeSlotAndLogWarning(parent);
if (oldParentSlot === newParentSlot) return this;
_detachChild(oldParentSlot, slot);
_attachChild(newParentSlot, slot);
_markDirty(slot, DIRTY_PARENT);
return this;
}
public get visible(): boolean | undefined {
const slot = this._slot;
return slot === INVALID_INDEX ? undefined : _isVisible(slot);
}
public set visible(visible: boolean) {
this.setVisible(visible);
}
public setVisible(visible: boolean): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
const currentVisible = _isVisible(slot);
if (currentVisible === visible) return this;
if (visible) {
_setFlag(slot, FLAG_VISIBLE);
} else {
_clearFlag(slot, FLAG_VISIBLE);
}
if (_isUIInputModeWhenVisible(slot)) {
const hasInputMode = _hasInputMode(slot);
if (visible && !hasInputMode) {
_setFlag(slot, FLAG_HAS_INPUT_MODE);
_getReceiver(slot).addInputModeRequester();
} else if (!visible && hasInputMode) {
_clearFlag(slot, FLAG_HAS_INPUT_MODE);
_getReceiver(slot).removeInputModeRequester();
}
}
_markDirty(slot, DIRTY_VISIBLE);
return this;
}
public show(): this {
return this.setVisible(true);
}
public hide(): this {
return this.setVisible(false);
}
public delete(): void {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return;
this._deleteRecursiveSlot(slot);
}
private _deleteRecursiveSlot(slot: number): void {
let child = _firstChild[slot];
while (child !== INVALID_INDEX) {
const next = _nextSibling[child];
const childInstance = _instances[child];
if (childInstance) {
childInstance.delete();
} else {
this._deleteRecursiveSlot(child);
}
child = next;
}
const parentSlot = _parents[slot];
_detachChild(parentSlot, slot);
if (_hasInputMode(slot)) {
_getReceiver(slot).removeInputModeRequester();
}
const nativeWidget = _nativeWidgets[slot];
if (nativeWidget) {
mod.DeleteUIWidget(nativeWidget);
}
_freeSlot(slot);
}
public get x(): number | undefined {
const slot = this._slot;
return slot === INVALID_INDEX ? undefined : _x[slot];
}
public set x(x: number) {
this.setX(x);
}
public setX(x: number): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
if (_x[slot] === x) return this;
_x[slot] = x;
_markDirty(slot, DIRTY_POSITION);
return this;
}
public get y(): number | undefined {
const slot = this._slot;
return slot === INVALID_INDEX ? undefined : _y[slot];
}
public set y(y: number) {
this.setY(y);
}
public setY(y: number): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
if (_y[slot] === y) return this;
_y[slot] = y;
_markDirty(slot, DIRTY_POSITION);
return this;
}
public get position(): Position | undefined {
return this.getPosition();
}
public set position(params: Position) {
this.setPosition(params);
}
public getPosition(out?: Position): Position | undefined {
const slot = this._slot;
if (slot === INVALID_INDEX) return undefined;
const target = out ?? { x: 0, y: 0 };
target.x = _x[slot];
target.y = _y[slot];
return target;
}
public setPosition(params: Position): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
if (_x[slot] === params.x && _y[slot] === params.y) return this;
_x[slot] = params.x;
_y[slot] = params.y;
_markDirty(slot, DIRTY_POSITION);
return this;
}
public get width(): number | undefined {
const slot = this._slot;
return slot === INVALID_INDEX ? undefined : _width[slot];
}
public set width(width: number) {
this.setWidth(width);
}
public setWidth(width: number): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
if (_width[slot] === width) return this;
_width[slot] = width;
_markDirty(slot, DIRTY_SIZE);
return this;
}
public get height(): number | undefined {
const slot = this._slot;
return slot === INVALID_INDEX ? undefined : _height[slot];
}
public set height(height: number) {
this.setHeight(height);
}
public setHeight(height: number): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
if (_height[slot] === height) return this;
_height[slot] = height;
_markDirty(slot, DIRTY_SIZE);
return this;
}
public get size(): Size | undefined {
return this.getSize();
}
public set size(params: Size) {
this.setSize(params);
}
public getSize(out?: Size): Size | undefined {
const slot = this._slot;
if (slot === INVALID_INDEX) return undefined;
const target = out ?? { width: 0, height: 0 };
target.width = _width[slot];
target.height = _height[slot];
return target;
}
public setSize(params: Size): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
if (_width[slot] === params.width && _height[slot] === params.height) return this;
_width[slot] = params.width;
_height[slot] = params.height;
_markDirty(slot, DIRTY_SIZE);
return this;
}
public get bgColor(): Color | undefined {
const slot = this._slot;
return slot === INVALID_INDEX ? undefined : _getBgColor(slot);
}
public getBgColor(out?: Color): Color | undefined {
const slot = this._slot;
return slot === INVALID_INDEX ? undefined : _getBgColor(slot, out);
}
public set bgColor(color: Color) {
this.setBgColor(color);
}
public setBgColor(color: Color): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
const rInt = Math.min(Math.max(Math.round(color.r * 255), 0), 255);
const gInt = Math.min(Math.max(Math.round(color.g * 255), 0), 255);
const bInt = Math.min(Math.max(Math.round(color.b * 255), 0), 255);
const currentRgba = _bgRgba[slot];
const newRgba = ((rInt << 24) | (gInt << 16) | (bInt << 8) | (currentRgba & 0xff)) >>> 0;
if (newRgba === currentRgba) return this;
_bgRgba[slot] = newRgba;
_markDirty(slot, DIRTY_BG_COLOR);
return this;
}
public get bgAlpha(): number | undefined {
const slot = this._slot;
return slot === INVALID_INDEX ? undefined : _getBgAlpha(slot);
}
public set bgAlpha(alpha: number) {
this.setBgAlpha(alpha);
}
public setBgAlpha(alpha: number): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
const aInt = Math.min(Math.max(Math.round(alpha * 255), 0), 255);
const currentRgba = _bgRgba[slot];
const newRgba = ((currentRgba & ~0xff) | aInt) >>> 0;
if (newRgba === currentRgba) return this;
_bgRgba[slot] = newRgba;
_markDirty(slot, DIRTY_BG_ALPHA);
return this;
}
public get bgFill(): BgFill | undefined {
const slot = this._slot;
return slot === INVALID_INDEX ? undefined : _getBgFill(slot);
}
public set bgFill(fill: BgFill) {
this.setBgFill(fill);
}
public setBgFill(fill: BgFill): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
if (_getBgFill(slot) === fill) return this;
_setBgFill(slot, fill);
_markDirty(slot, DIRTY_BG_FILL);
return this;
}
public get depth(): Depth | undefined {
const slot = this._slot;
return slot === INVALID_INDEX ? undefined : _getDepth(slot);
}
public set depth(depth: Depth) {
this.setDepth(depth);
}
public setDepth(depth: Depth): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
if (_getDepth(slot) === depth) return this;
_setDepth(slot, depth);
_markDirty(slot, DIRTY_DEPTH);
return this;
}
public get anchor(): Anchor | undefined {
const slot = this._slot;
return slot === INVALID_INDEX ? undefined : _getAnchor(slot);
}
public set anchor(anchor: Anchor) {
this.setAnchor(anchor);
}
public setAnchor(anchor: Anchor): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
if (_getAnchor(slot) === anchor) return this;
_setAnchor(slot, anchor);
_markDirty(slot, DIRTY_ANCHOR);
return this;
}
public get uiInputModeWhenVisible(): boolean | undefined {
const slot = this._slot;
return slot === INVALID_INDEX ? undefined : _isUIInputModeWhenVisible(slot);
}
public set uiInputModeWhenVisible(newValue: boolean) {
this.setUiInputModeWhenVisible(newValue);
}
public setUiInputModeWhenVisible(newValue: boolean): this {
const slot = this._getSlotAndLogWarning();
if (slot === INVALID_INDEX) return this;
const isVisible = _isVisible(slot);
const hasInputMode = _hasInputMode(slot);
if (newValue) {
_setFlag(slot, FLAG_UI_INPUT_MODE_WHEN_VISIBLE);
} else {
_clearFlag(slot, FLAG_UI_INPUT_MODE_WHEN_VISIBLE);
}
if (newValue && isVisible && !hasInputMode) {
_setFlag(slot, FLAG_HAS_INPUT_MODE);
_getReceiver(slot).addInputModeRequester();
} else if ((!newValue || !isVisible) && hasInputMode) {
_clearFlag(slot, FLAG_HAS_INPUT_MODE);
_getReceiver(slot).removeInputModeRequester();
}
return this;
}
}
export const COLORS = Colors.PRESETS;
Events.OnTickEnd.subscribe(flush, Events.EventPriority.Last);
Events.OnPlayerLeaveGame.subscribe((playerId: number) => {
PlayerReceiver.clear(playerId);
});
}
// --- SOURCE: src\diag.ts ---
export const logging = new Logging("SfxVfxShowcase");
let installed = false;
let debug = false;
export function debugEnabled(): boolean {
return debug;
}
const sink = (text: string): void => console.log(text);
function applyUiLogLevel(): void {
UI.setLogging(sink, debug ? Logging.LogLevel.Debug : Logging.LogLevel.Warning, true);
}
export function setDebug(on: boolean): void {
debug = on;
if (installed) applyUiLogLevel();
}
export function initLog(): void {
if (installed) return;
installed = true;
logging.setLogging(sink, Logging.LogLevel.Debug, true);
applyUiLogLevel();
}
export function log(text: string): void {
if (!debug) return;
logging.log(text, Logging.LogLevel.Debug);
}
export function logAlways(text: string): void {
logging.log(text, Logging.LogLevel.Debug);
}
const reported = new Set<string>();
export function reportMissingKey(literal: string, where: string): void {
const k = where + "|" + literal;
if (reported.has(k)) return;
reported.add(k);
log(`MISSING TEXT KEY: ${JSON.stringify(literal)} from ${where} -- add it to tools/gen-text.mjs`);
}
// --- SOURCE: src\qrids.gen.ts ---
export const QR_FORMAT = 1;
export const QR_MAPPING = 1;
export const SFX_ID_RUNS: readonly number[] = [0,0];
export const VFX_ID_RUNS: readonly number[] = [0,936];
export const NAMED_IDS: { readonly [key: string]: number } = {
"screen:vl7gas": 1248,
"screen:night": 1249,
"screen:saturated": 1250,
"screen:stealth": 1251,
"e:BR_InsertionCinematic_Dropzone_Loop": 1252,
"e:BR_InsertionCinematic_Loop": 1253,
"e:BR_InsertionJump": 1254,
"e:BR_InsertionLanding": 1255,
"e:BR_LastTwoSquads": 1256,
"e:BR_Loss_Early_Loop": 1257,
"e:BR_Loss_EndOfRound_Loop": 1258,
"e:BR_Loss_SecondPlace_Loop": 1259,
"e:BR_Pause": 1260,
"e:BR_RespawnSecondChance": 1261,
"e:BR_RespawnTower": 1262,
"e:BR_Unpause": 1263,
"e:BR_WonRound_Loop": 1264,
"e:BRGauntlet_LobbyFilled": 1265,
"e:BRGauntlet_WaitingForPlayers_Loop": 1266,
"e:Core_Deploy_Loop": 1267,
"e:Core_EndOfRound_Loop": 1268,
"e:Core_LastPhaseBegin": 1269,
"e:Core_Overtime_Loop": 1270,
"e:Core_PauseMenu_Loop": 1271,
"e:Core_PhaseBegin": 1272,
"e:Core_PhaseEnded": 1273,
"e:Core_Stinger_Negative": 1274,
"e:Core_Stinger_Positive": 1275,
"e:Core_Stinger_RankUp": 1276,
"e:Gauntlet_Deploy": 1277,
"e:Gauntlet_Loss_FinalMission_Loop": 1278,
"e:Gauntlet_Loss_Loop": 1279,
"e:Gauntlet_MissionBriefing_Final": 1280,
"e:Gauntlet_MissionBriefing_One": 1281,
"e:Gauntlet_MissionBriefing_Three": 1282,
"e:Gauntlet_MissionBriefing_Two": 1283,
"e:Gauntlet_Pause": 1284,
"e:Gauntlet_Qualified_Loop": 1285,
"e:Gauntlet_Qualified_Outro": 1286,
"e:Gauntlet_Unpause": 1287,
"e:Gauntlet_Urgency": 1288,
"e:Gauntlet_Urgency_FinalMission": 1289,
"e:Gauntlet_WonOperation_Loop": 1290,
"e:Radio_ClearQueue": 1291,
"e:Radio_NextQueuedTrack": 1292,
"e:Radio_Play": 1293,
"p:BR_Amplitude": 1294,
"p:BRGauntlet_LobbyTimerRemaining": 1295,
"p:Core_Amplitude": 1296,
"p:Core_IsWinning": 1297,
"p:Core_PhaseUrgency": 1298,
"p:Core_Sector": 1299,
"p:Core_Urgency": 1300,
"p:Gauntlet_Amplitude": 1301,
"p:Radio_Amplitude": 1302,
"p:Radio_Biome": 1303,
"p:Radio_Channel": 1304,
"p:Radio_ContinueQueueOnTrackEnd": 1305,
"p:Radio_LoopQueuedTracks": 1306,
"p:Radio_QueueTrackNumber": 1307,
};
// --- SOURCE: src\qrexport.ts ---
export const QR_BYTES = 718;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const HASH_MOD = 1048573;
export function qrId(n: number, width: number = 3): string {
let s = "";
for (let i = 0; i < width; i++) {
s = ALPHABET.charAt(n % 32) + s;
n = Math.floor(n / 32);
}
return s;
}
export function runId(runs: readonly number[], index: number): number {
let at = 0;
for (let i = 0; i < runs.length; i += 2) if (runs[i] <= index) at = i;
return runs[at + 1] + (index - runs[at]);
}
export function qrNum(v: number): string {
return String(Math.round(v * 100) / 100);
}
function hash(s: string): string {
let h = 0;
for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % HASH_MOD;
return qrId(h, 4);
}
function header(part: number, of: number, list: string): string {
return "SV" + QR_FORMAT + "." + QR_MAPPING + "." + part + "-" + of + "." + list + ".";
}
function fit(code: string, room: number): string {
let cut = code;
while (cut.length > room && cut.lastIndexOf(";") > 0) cut = cut.slice(0, cut.lastIndexOf(";"));
return cut;
}
export function packQrPayloads(codes: readonly string[], prefix: string): string[] {
if (codes.length === 0) return [];
const room = QR_BYTES - prefix.length - header(99, 99, "0000").length - 5;
const parts: string[] = [];
let cur = "";
for (const raw of codes) {
const code = fit(raw, room);
if (cur !== "" && cur.length + code.length > room) {
parts.push(cur);
cur = "";
}
cur += code;
}
parts.push(cur);
const list = hash(parts.join(""));
const out: string[] = [];
for (let i = 0; i < parts.length; i++) {
const head = header(i + 1, parts.length, list) + parts[i];
out.push(prefix + head + "." + hash(head));
}
return out;
}
// --- SOURCE: src\music.gen.ts ---
export interface MusicParamSpec {
readonly name: string;
readonly param: mod.MusicParams;
readonly key: string;
readonly min: number;
readonly max: number;
readonly step: number;
readonly def: number;
readonly queues: boolean;
readonly desc: string;
}
export interface MusicEventSpec {
readonly name: string;
readonly event: mod.MusicEvents;
readonly key: string;
readonly desc: string;
}
export interface MusicPackageSpec {
readonly name: string;
readonly pkg: mod.MusicPackages;
readonly key: string;
readonly stop: mod.MusicEvents;
readonly stopKey: string;
readonly events: readonly MusicEventSpec[];
readonly amp: MusicParamSpec;
readonly params: readonly MusicParamSpec[];
}
export const PARAM_SLOTS = 5;
export const MUSIC_PACKAGES: readonly MusicPackageSpec[] = [
{
name: "BR",
pkg: mod.MusicPackages.BR,
key: "sxM00",
stop: mod.MusicEvents.BR_Stop,
stopKey: "sxM01",
events: [
{ name: "BR_InsertionCinematic_Dropzone_Loop", event: mod.MusicEvents.BR_InsertionCinematic_Dropzone_Loop, key: "sxM02", desc: "sxD00" },
{ name: "BR_InsertionCinematic_Loop", event: mod.MusicEvents.BR_InsertionCinematic_Loop, key: "sxM03", desc: "sxD01" },
{ name: "BR_InsertionJump", event: mod.MusicEvents.BR_InsertionJump, key: "sxM04", desc: "sxD02" },
{ name: "BR_InsertionLanding", event: mod.MusicEvents.BR_InsertionLanding, key: "sxM05", desc: "sxD03" },
{ name: "BR_LastTwoSquads", event: mod.MusicEvents.BR_LastTwoSquads, key: "sxM06", desc: "sxD04" },
{ name: "BR_Loss_Early_Loop", event: mod.MusicEvents.BR_Loss_Early_Loop, key: "sxM07", desc: "sxD05" },
{ name: "BR_Loss_EndOfRound_Loop", event: mod.MusicEvents.BR_Loss_EndOfRound_Loop, key: "sxM08", desc: "sxD06" },
{ name: "BR_Loss_SecondPlace_Loop", event: mod.MusicEvents.BR_Loss_SecondPlace_Loop, key: "sxM09", desc: "sxD07" },
{ name: "BR_Pause", event: mod.MusicEvents.BR_Pause, key: "sxM10", desc: "sxD08" },
{ name: "BR_RespawnSecondChance", event: mod.MusicEvents.BR_RespawnSecondChance, key: "sxM11", desc: "sxD09" },
{ name: "BR_RespawnTower", event: mod.MusicEvents.BR_RespawnTower, key: "sxM12", desc: "sxD10" },
{ name: "BR_Unpause", event: mod.MusicEvents.BR_Unpause, key: "sxM13", desc: "sxD11" },
{ name: "BR_WonRound_Loop", event: mod.MusicEvents.BR_WonRound_Loop, key: "sxM14", desc: "sxD12" },
{ name: "BRGauntlet_LobbyFilled", event: mod.MusicEvents.BRGauntlet_LobbyFilled, key: "sxM15", desc: "sxD13" },
{ name: "BRGauntlet_WaitingForPlayers_Loop", event: mod.MusicEvents.BRGauntlet_WaitingForPlayers_Loop, key: "sxM16", desc: "sxD14" },
],
amp: { name: "BR_Amplitude", param: mod.MusicParams.BR_Amplitude, key: "sxM17", min: 0, max: 3, step: 0.1, def: 1, queues: false, desc: "" },
params: [
{ name: "BRGauntlet_LobbyTimerRemaining", param: mod.MusicParams.BRGauntlet_LobbyTimerRemaining, key: "sxM18", min: 0, max: 10, step: 1, def: 10, queues: false, desc: "sxD15" },
],
},
{
name: "Core",
pkg: mod.MusicPackages.Core,
key: "sxM19",
stop: mod.MusicEvents.Core_Stop,
stopKey: "sxM20",
events: [
{ name: "Core_Deploy_Loop", event: mod.MusicEvents.Core_Deploy_Loop, key: "sxM21", desc: "sxD16" },
{ name: "Core_EndOfRound_Loop", event: mod.MusicEvents.Core_EndOfRound_Loop, key: "sxM22", desc: "sxD17" },
{ name: "Core_LastPhaseBegin", event: mod.MusicEvents.Core_LastPhaseBegin, key: "sxM23", desc: "sxD18" },
{ name: "Core_Overtime_Loop", event: mod.MusicEvents.Core_Overtime_Loop, key: "sxM24", desc: "sxD19" },
{ name: "Core_PauseMenu_Loop", event: mod.MusicEvents.Core_PauseMenu_Loop, key: "sxM25", desc: "sxD20" },
{ name: "Core_PhaseBegin", event: mod.MusicEvents.Core_PhaseBegin, key: "sxM26", desc: "sxD21" },
{ name: "Core_PhaseEnded", event: mod.MusicEvents.Core_PhaseEnded, key: "sxM27", desc: "sxD22" },
{ name: "Core_Stinger_Negative", event: mod.MusicEvents.Core_Stinger_Negative, key: "sxM28", desc: "sxD23" },
{ name: "Core_Stinger_Positive", event: mod.MusicEvents.Core_Stinger_Positive, key: "sxM29", desc: "sxD24" },
{ name: "Core_Stinger_RankUp", event: mod.MusicEvents.Core_Stinger_RankUp, key: "sxM30", desc: "sxD25" },
],
amp: { name: "Core_Amplitude", param: mod.MusicParams.Core_Amplitude, key: "sxM31", min: 0, max: 3, step: 0.1, def: 1, queues: false, desc: "" },
params: [
{ name: "Core_IsWinning", param: mod.MusicParams.Core_IsWinning, key: "sxM32", min: 0, max: 1, step: 1, def: 0, queues: false, desc: "sxD26" },
{ name: "Core_PhaseUrgency", param: mod.MusicParams.Core_PhaseUrgency, key: "sxM33", min: 0, max: 3, step: 0.5, def: 0, queues: false, desc: "sxD27" },
{ name: "Core_Sector", param: mod.MusicParams.Core_Sector, key: "sxM34", min: 0, max: 3, step: 1, def: 0, queues: false, desc: "sxD28" },
{ name: "Core_Urgency", param: mod.MusicParams.Core_Urgency, key: "sxM35", min: 0, max: 4, step: 0.5, def: 0, queues: false, desc: "sxD29" },
],
},
{
name: "Gauntlet",
pkg: mod.MusicPackages.Gauntlet,
key: "sxM36",
stop: mod.MusicEvents.Gauntlet_Stop,
stopKey: "sxM37",
events: [
{ name: "Gauntlet_Deploy", event: mod.MusicEvents.Gauntlet_Deploy, key: "sxM38", desc: "sxD30" },
{ name: "Gauntlet_Loss_FinalMission_Loop", event: mod.MusicEvents.Gauntlet_Loss_FinalMission_Loop, key: "sxM39", desc: "sxD31" },
{ name: "Gauntlet_Loss_Loop", event: mod.MusicEvents.Gauntlet_Loss_Loop, key: "sxM40", desc: "sxD32" },
{ name: "Gauntlet_MissionBriefing_Final", event: mod.MusicEvents.Gauntlet_MissionBriefing_Final, key: "sxM41", desc: "sxD33" },
{ name: "Gauntlet_MissionBriefing_One", event: mod.MusicEvents.Gauntlet_MissionBriefing_One, key: "sxM42", desc: "sxD34" },
{ name: "Gauntlet_MissionBriefing_Three", event: mod.MusicEvents.Gauntlet_MissionBriefing_Three, key: "sxM43", desc: "sxD35" },
{ name: "Gauntlet_MissionBriefing_Two", event: mod.MusicEvents.Gauntlet_MissionBriefing_Two, key: "sxM44", desc: "sxD36" },
{ name: "Gauntlet_Pause", event: mod.MusicEvents.Gauntlet_Pause, key: "sxM45", desc: "sxD37" },
{ name: "Gauntlet_Qualified_Loop", event: mod.MusicEvents.Gauntlet_Qualified_Loop, key: "sxM46", desc: "sxD38" },
{ name: "Gauntlet_Qualified_Outro", event: mod.MusicEvents.Gauntlet_Qualified_Outro, key: "sxM47", desc: "sxD39" },
{ name: "Gauntlet_Unpause", event: mod.MusicEvents.Gauntlet_Unpause, key: "sxM48", desc: "sxD40" },
{ name: "Gauntlet_Urgency", event: mod.MusicEvents.Gauntlet_Urgency, key: "sxM49", desc: "sxD41" },
{ name: "Gauntlet_Urgency_FinalMission", event: mod.MusicEvents.Gauntlet_Urgency_FinalMission, key: "sxM50", desc: "sxD42" },
{ name: "Gauntlet_WonOperation_Loop", event: mod.MusicEvents.Gauntlet_WonOperation_Loop, key: "sxM51", desc: "sxD43" },
],
amp: { name: "Gauntlet_Amplitude", param: mod.MusicParams.Gauntlet_Amplitude, key: "sxM52", min: 0, max: 3, step: 0.1, def: 1, queues: false, desc: "" },
params: [
],
},
{
name: "Radio",
pkg: mod.MusicPackages.Radio,
key: "sxM53",
stop: mod.MusicEvents.Radio_Stop,
stopKey: "sxM54",
events: [
{ name: "Radio_ClearQueue", event: mod.MusicEvents.Radio_ClearQueue, key: "sxM55", desc: "sxD44" },
{ name: "Radio_NextQueuedTrack", event: mod.MusicEvents.Radio_NextQueuedTrack, key: "sxM56", desc: "sxD45" },
{ name: "Radio_Play", event: mod.MusicEvents.Radio_Play, key: "sxM57", desc: "sxD46" },
],
amp: { name: "Radio_Amplitude", param: mod.MusicParams.Radio_Amplitude, key: "sxM58", min: 0, max: 3, step: 0.1, def: 1, queues: false, desc: "" },
params: [
{ name: "Radio_Biome", param: mod.MusicParams.Radio_Biome, key: "sxM59", min: 0, max: 6, step: 1, def: 0, queues: false, desc: "sxD47" },
{ name: "Radio_Channel", param: mod.MusicParams.Radio_Channel, key: "sxM60", min: 0, max: 6, step: 1, def: 2, queues: false, desc: "sxD48" },
{ name: "Radio_ContinueQueueOnTrackEnd", param: mod.MusicParams.Radio_ContinueQueueOnTrackEnd, key: "sxM61", min: 0, max: 1, step: 1, def: 1, queues: false, desc: "sxD49" },
{ name: "Radio_LoopQueuedTracks", param: mod.MusicParams.Radio_LoopQueuedTracks, key: "sxM62", min: 0, max: 1, step: 1, def: 1, queues: false, desc: "sxD50" },
{ name: "Radio_QueueTrackNumber", param: mod.MusicParams.Radio_QueueTrackNumber, key: "sxM63", min: 0, max: 31, step: 1, def: 0, queues: true, desc: "sxD51" },
],
},
];
// --- SOURCE: src\scene.gen.ts ---
export interface SceneNode {
k: "container" | "text" | "textbutton" | "button" | "repeat" | "group";
id?: string;
x: number;
y: number;
w?: number;
h?: number;
count?: number;
gap?: number;
gapX?: number;
gapY?: number;
cols?: number;
template?: SceneNode | null;
parent?: string;
visible?: boolean;
fill?: string;
bg?: string;
bgAlpha?: number;
text?: string;
textSize?: number;
color?: string;
textColor?: string;
textAlpha?: number;
align?: string;
wrap?: boolean;
enabled?: boolean;
wScale?: string;
bind?: Record<string, string>;
}
export const PALETTE: Readonly<Record<string, string>> = {
"shell": "#0B0A10",
"panel": "#161322",
"row": "#241E36",
"rowSel": "#4A2937",
"line": "#2A2438",
"hairline": "#4E4272",
"ink": "#F7EBE2",
"inkDim": "#CFC3CD",
"muted": "#A8B4C4",
"faint": "#8B96A4",
"red": "#F04437",
"redDim": "#8E241C",
"blue": "#4A90F0",
"green": "#3ED277",
"amber": "#F5B443",
"violet": "#A87BF0",
"grey": "#7C838E",
"headerBg": "#1E1A2E",
"hot": "#FF7A1A",
"redDeep": "#5C1A12",
"orangeDim": "#A8480C"
};
export const GRID = {
"cols": 1,
"rows": 8,
"rowW": 1316,
"rowH": 58,
"originX": 452,
"originY": 304
} as const;
export const RAIL = {
"x": 140,
"y": 216,
"w": 300,
"h": 684,
"rowsY": 262,
"rowH": 32,
"rowPadX": 6,
"rowW": 288,
"visibleRows": 18,
"pagerY": 848,
"pagerH": 28,
"pagerW": 132
} as const;
export const RAIL_ROW: SceneNode = {
"k": "textbutton",
"x": 0,
"y": 0,
"w": 288,
"h": 30,
"text": "{{rail.label}}",
"textSize": 13,
"textColor": "{{rail.color}}",
"bg": "{{rail.bg}}",
"bgAlpha": 1,
"align": "Left",
"fill": "Solid"
};
export const RAIL_PAGER: readonly SceneNode[] = [
{
"k": "textbutton",
"id": "btnRailPrev",
"x": 146,
"y": 848,
"w": 132,
"h": 28,
"text": "< GROUPS",
"textSize": 11,
"textColor": "#FFFFFF",
"bg": "{{sh.orangeDim}}",
"bgAlpha": 1,
"align": "Center",
"parent": "menu",
"fill": "Solid"
},
{
"k": "text",
"id": "railPage",
"x": 282,
"y": 848,
"w": 16,
"h": 28,
"text": "{{f.railPage}}",
"textSize": 11,
"textColor": "{{sh.muted}}",
"align": "Center",
"parent": "menu"
},
{
"k": "textbutton",
"id": "btnRailNext",
"x": 302,
"y": 848,
"w": 132,
"h": 28,
"text": "GROUPS >",
"textSize": 11,
"textColor": "#FFFFFF",
"bg": "{{sh.orangeDim}}",
"bgAlpha": 1,
"align": "Center",
"parent": "menu",
"fill": "Solid"
}
];
export const SCREEN: readonly SceneNode[] = [
{
"k": "group",
"id": "menu",
"x": 0,
"y": 0,
"visible": true,
"bind": {
"visible": "menuOpen"
}
},
{
"k": "group",
"id": "browser",
"x": 0,
"y": 0,
"visible": true,
"bind": {
"visible": "browserOn"
},
"parent": "menu"
},
{
"k": "container",
"x": 140,
"y": 140,
"w": 1640,
"h": 800,
"fill": "Solid",
"bg": "{{sh.shell}}",
"bgAlpha": 0.98,
"parent": "menu"
},
{
"k": "container",
"x": 140,
"y": 140,
"w": 1640,
"h": 76,
"fill": "Solid",
"bg": "{{sh.panel}}",
"bgAlpha": 1,
"parent": "menu"
},
{
"k": "container",
"x": 140,
"y": 215,
"w": 1640,
"h": 1,
"fill": "Solid",
"bg": "{{sh.hairline}}",
"bgAlpha": 1,
"parent": "menu"
},
{
"k": "container",
"x": 140,
"y": 215,
"w": 300,
"h": 684,
"fill": "Solid",
"bg": "{{sh.panel}}",
"bgAlpha": 1,
"parent": "browser"
},
{
"k": "container",
"x": 439,
"y": 215,
"w": 1,
"h": 684,
"fill": "Solid",
"bg": "{{sh.hairline}}",
"bgAlpha": 1,
"parent": "browser"
},
{
"k": "container",
"x": 452,
"y": 216,
"w": 1316,
"h": 46,
"fill": "Solid",
"bg": "{{sh.panel}}",
"bgAlpha": 1,
"parent": "browser"
},
{
"k": "container",
"x": 452,
"y": 261,
"w": 1316,
"h": 1,
"fill": "Solid",
"bg": "{{sh.hairline}}",
"bgAlpha": 1,
"parent": "browser"
},
{
"k": "container",
"x": 452,
"y": 262,
"w": 1316,
"h": 38,
"fill": "Solid",
"bg": "{{sh.shell}}",
"bgAlpha": 1,
"parent": "browser"
},
{
"k": "container",
"x": 452,
"y": 772,
"w": 1316,
"h": 48,
"fill": "Solid",
"bg": "{{sh.panel}}",
"bgAlpha": 1,
"parent": "browser"
},
{
"k": "container",
"x": 452,
"y": 824,
"w": 1316,
"h": 76,
"fill": "Solid",
"bg": "{{sh.panel}}",
"bgAlpha": 1,
"parent": "browser"
},
{
"k": "container",
"x": 140,
"y": 900,
"w": 1640,
"h": 40,
"fill": "Solid",
"bg": "{{sh.shell}}",
"bgAlpha": 1,
"parent": "menu"
},
{
"k": "text",
"x": 156,
"y": 140,
"w": 216,
"h": 76,
"text": "SFX / VFX SHOWCASE",
"textSize": 20,
"color": "{{sh.ink}}",
"textAlpha": 1,
"align": "Left",
"parent": "menu"
},
{
"k": "textbutton",
"id": "tabSfx",
"x": 512,
"y": 152,
"w": 124,
"h": 56,
"text": "SOUND",
"textSize": 18,
"textColor": "{{f.tabSfxColor}}",
"bg": "{{f.tabSfxBg}}",
"bgAlpha": 1,
"align": "Center",
"parent": "menu",
"fill": "Solid"
},
{
"k": "textbutton",
"id": "tabVfx",
"x": 644,
"y": 152,
"w": 124,
"h": 56,
"text": "VISUAL",
"textSize": 18,
"textColor": "{{f.tabVfxColor}}",
"bg": "{{f.tabVfxBg}}",
"bgAlpha": 1,
"align": "Center",
"parent": "menu",
"fill": "Solid"
},
{
"k": "textbutton",
"id": "tabFav",
"x": 776,
"y": 152,
"w": 140,
"h": 56,
"text": "FAVOURITES",
"textSize": 14,
"textColor": "{{f.tabFavColor}}",
"bg": "{{f.tabFavBg}}",
"bgAlpha": 1,
"align": "Center",
"parent": "menu",
"fill": "Solid"
},
{
"k": "textbutton",
"id": "tabMusic",
"x": 924,
"y": 152,
"w": 124,
"h": 56,
"text": "MUSIC",
"textSize": 18,
"textColor": "{{f.tabMusicColor}}",
"bg": "{{f.tabMusicBg}}",
"bgAlpha": 1,
"align": "Center",
"parent": "menu",
"fill": "Solid"
},
{
"k": "textbutton",
"id": "tabRadio",
"x": 1056,
"y": 152,
"w": 124,
"h": 56,
"text": "RADIO",
"textSize": 18,
"textColor": "{{f.tabRadioColor}}",
"bg": "{{f.tabRadioBg}}",
"bgAlpha": 1,
"align": "Center",
"parent": "menu",
"fill": "Solid"
},
{
"k": "textbutton",
"id": "btnSelect",
"x": 1188,
"y": 152,
"w": 164,
"h": 56,
"text": "{{f.selectLabel}}",
"textSize": 15,
"textColor": "{{sh.ink}}",
"bg": "{{f.selectBg}}",
"bgAlpha": 1,
"align": "Center",
"parent": "browser",
"bind": {
"text": "selectLabel",
"bg": "selectBg"
},
"fill": "Solid"
},
{
"k": "group",
"id": "armedGrp",
"x": 0,
"y": 0,
"visible": true,
"parent": "menu",
"bind": {
"visible": "armedOn"
}
},
{
"k": "text",
"id": "armed",
"x": 1360,
"y": 142,
"w": 192,
"h": 52,
"text": "{{f.armed}}",
"textSize": 11,
"color": "{{f.armedColor}}",
"align": "Right",
"wrap": true,
"parent": "armedGrp",
"bind": {
"text": "armed",
"color": "armedColor"
}
},
{
"k": "group",
"id": "favHead",
"x": 0,
"y": 0,
"visible": false,
"parent": "menu",
"bind": {
"visible": "favHead"
}
},
{
"k": "textbutton",
"id": "btnQr",
"x": 1360,
"y": 152,
"w": 192,
"h": 56,
"text": "QR CODE",
"textSize": 15,
"textColor": "{{f.qrBtnColor}}",
"bg": "{{f.qrBtnBg}}",
"bgAlpha": 1,
"align": "Center",
"parent": "favHead",
"fill": "Solid"
},
{
"k": "textbutton",
"id": "btnClose",
"x": 1560,
"y": 152,
"w": 204,
"h": 56,
"text": "CLOSE X",
"textSize": 18,
"textColor": "{{sh.red}}",
"bg": "{{sh.line}}",
"bgAlpha": 1,
"align": "Center",
"parent": "menu",
"fill": "Solid"
},
{
"k": "text",
"x": 156,
"y": 216,
"w": 140,
"h": 46,
"text": "GROUP",
"textSize": 13,
"color": "{{sh.muted}}",
"align": "Left",
"parent": "browser"
},
{
"k": "text",
"id": "railCount",
"x": 250,
"y": 216,
"w": 182,
"h": 46,
"text": "{{f.railSummary}}",
"textSize": 11,
"color": "{{sh.faint}}",
"align": "Right",
"parent": "browser",
"bind": {
"text": "railSummary"
}
},
{
"k": "container",
"x": 156,
"y": 260,
"w": 268,
"h": 1,
"fill": "Solid",
"bg": "{{sh.hairline}}",
"bgAlpha": 1,
"parent": "browser"
},
{
"k": "text",
"x": 694,
"y": 262,
"w": 560,
"h": 38,
"text": "NAME",
"textSize": 12,
"color": "{{sh.muted}}",
"align": "Left",
"parent": "browser"
},
{
"k": "text",
"x": 1108,
"y": 262,
"w": 230,
"h": 38,
"text": "GROUP",
"textSize": 12,
"color": "{{sh.muted}}",
"align": "Left",
"parent": "browser"
},
{
"k": "text",
"x": 1350,
"y": 262,
"w": 180,
"h": 38,
"text": "ACTION",
"textSize": 12,
"color": "{{sh.muted}}",
"align": "Left",
"parent": "browser"
},
{
"k": "text",
"x": 1542,
"y": 262,
"w": 226,
"h": 38,
"text": "{{f.headBadge}}",
"textSize": 12,
"color": "{{sh.muted}}",
"align": "Center",
"parent": "browser",
"bind": {
"text": "headBadge"
}
},
{
"k": "textbutton",
"id": "btnPrev",
"x": 452,
"y": 776,
"w": 150,
"h": 44,
"text": "< PREV",
"textSize": 15,
"textColor": "#FFFFFF",
"bg": "{{sh.orangeDim}}",
"bgAlpha": 1,
"align": "Center",
"parent": "browser",
"fill": "Solid"
},
{
"k": "text",
"id": "pageLabel",
"x": 640,
"y": 776,
"w": 940,
"h": 44,
"text": "{{f.page}}",
"textSize": 15,
"color": "{{sh.inkDim}}",
"align": "Center",
"parent": "browser",
"bind": {
"text": "page"
}
},
{
"k": "textbutton",
"id": "btnNext",
"x": 1618,
"y": 776,
"w": 150,
"h": 44,
"text": "NEXT >",
"textSize": 15,
"textColor": "#FFFFFF",
"bg": "{{sh.orangeDim}}",
"bgAlpha": 1,
"align": "Center",
"parent": "browser",
"fill": "Solid"
},
{
"k": "group",
"id": "sfxParams",
"x": 462,
"y": 828,
"visible": true,
"bind": {
"visible": "sfxParams"
},
"parent": "browser"
},
{
"k": "text",
"x": 0,
"y": 0,
"w": 150,
"h": 30,
"text": "AMPLITUDE",
"textSize": 12,
"color": "{{sh.muted}}",
"align": "Left",
"parent": "sfxParams"
},
{
"k": "textbutton",
"id": "btnAmpDown",
"x": 0,
"y": 32,
"w": 48,
"h": 36,
"text": "-",
"textSize": 15,
"textColor": "#FFFFFF",
"bg": "{{sh.orangeDim}}",
"bgAlpha": 1,
"align": "Center",
"parent": "sfxParams",
"fill": "Solid"
},
{
"k": "text",
"id": "txtAmp",
"x": 54,
"y": 32,
"w": 90,
"h": 36,
"text": "{{f.amp}}",
"textSize": 15,
"color": "{{sh.amber}}",
"align": "Center",
"parent": "sfxParams",
"bind": {
"text": "amp"
}
},
{
"k": "textbutton",
"id": "btnAmpUp",
"x": 150,
"y": 32,
"w": 48,
"h": 36,
"text": "+",
"textSize": 15,
"textColor": "#FFFFFF",
"bg": "{{sh.orangeDim}}",
"bgAlpha": 1,
"align": "Center",
"parent": "sfxParams",
"fill": "Solid"
},
{
"k": "text",
"x": 216,
"y": 0,
"w": 110,
"h": 30,
"text": "RANGE m",
"textSize": 12,
"color": "{{sh.muted}}",
"align": "Left",
"parent": "sfxParams"
},
{
"k": "textbutton",
"id": "btnRngDown",
"x": 216,
"y": 32,
"w": 48,
"h": 36,
"text": "-",
"textSize": 15,
"textColor": "#FFFFFF",
"bg": "{{sh.orangeDim}}",
"bgAlpha": 1,
"align": "Center",
"parent": "sfxParams",
"fill": "Solid"
},
{
"k": "text",
"id": "txtRng",
"x": 270,
"y": 32,
"w": 90,
"h": 36,
"text": "{{f.rng}}",
"textSize": 15,
"color": "{{sh.amber}}",
"align": "Center",
"parent": "sfxParams",
"bind": {
"text": "rng"
}
},
{
"k": "textbutton",
"id": "btnRngUp",
"x": 366,
"y": 32,
"w": 48,
"h": 36,
"text": "+",
"textSize": 15,
"textColor": "#FFFFFF",
"bg": "{{sh.orangeDim}}",
"bgAlpha": 1,
"align": "Center",
"parent": "sfxParams",
"fill": "Solid"
},
{
"k": "group",
"id": "vfxParams",
"x": 462,
"y": 828,
"visible": false,
"bind": {
"visible": "vfxParams"
},
"parent": "browser"
},
{
"k": "text",
"x": 0,
"y": 0,
"w": 90,
"h": 30,
"text": "SCALE",
"textSize": 12,
"color": "{{sh.muted}}",
"align": "Left",
"parent": "vfxParams"
},
{
"k": "textbutton",
"id": "btnScaleDown",
"x": 0,
"y": 32,
"w": 48,
"h": 36,
"text": "-",
"textSize": 15,
"textColor": "#FFFFFF",
"bg": "{{sh.orangeDim}}",
"bgAlpha": 1,
"align": "Center",
"parent": "vfxParams",
"fill": "Solid"
},
{
"k": "text",
"id": "txtScale",
"x": 54,
"y": 32,
"w": 110,
"h": 36,
"text": "{{f.scale}}",
"textSize": 15,
"color": "{{sh.amber}}",
"align": "Center",
"parent": "vfxParams",
"bind": {
"text": "scale"
}
},
{
"k": "textbutton",
"id": "btnScaleUp",
"x": 170,
"y": 32,
"w": 48,
"h": 36,
"text": "+",
"textSize": 15,
"textColor": "#FFFFFF",
"bg": "{{sh.orangeDim}}",
"bgAlpha": 1,
"align": "Center",
"parent": "vfxParams",
"fill": "Solid"
},
{
"k": "text",
"x": 236,
"y": 0,
"w": 300,
"h": 68,
"text": "applies to the selected effect",
"textSize": 11,
"color": "{{sh.faint}}",
"align": "Left",
"wrap": true,
"parent": "vfxParams"
},
{
"k": "text",
"id": "spawned",
"x": 896,
"y": 828,
"w": 190,
"h": 68,
"text": "{{f.spawned}}",
"textSize": 12,
"color": "{{sh.faint}}",
"align": "Right",
"wrap": true,
"parent": "browser",
"bind": {
"text": "spawned"
}
},
{
"k": "textbutton",
"id": "btnDebug",
"x": 380,
"y": 152,
"w": 124,
"h": 56,
"text": "{{f.debugLabel}}",
"textSize": 12,
"textColor": "{{f.debugColor}}",
"bg": "{{f.debugBg}}",
"bgAlpha": 1,
"align": "Center",
"parent": "menu",
"fill": "Solid"
},
{
"k": "textbutton",
"id": "btnStopAll",
"x": 1096,
"y": 844,
"w": 174,
"h": 40,
"text": "STOP ALL",
"textSize": 14,
"textColor": "#FFFFFF",
"bg": "{{sh.orangeDim}}",
"bgAlpha": 1,
"align": "Center",
"parent": "browser",
"fill": "Solid"
},
{
"k": "textbutton",
"id": "btnUndo",
"x": 1280,
"y": 844,
"w": 180,
"h": 40,
"text": "UNDO",
"textSize": 14,
"textColor": "#FFFFFF",
"bg": "{{sh.orangeDim}}",
"bgAlpha": 1,
"align": "Center",
"parent": "browser",
"fill": "Solid"
},
{
"k": "textbutton",
"id": "btnDeleteAll",
"x": 1470,
"y": 844,
"w": 260,
"h": 40,
"text": "DELETE ALL",
"textSize": 14,
"textColor": "#FFFFFF",
"bg": "{{sh.redDeep}}",
"bgAlpha": 1,
"align": "Center",
"parent": "browser",
"fill": "Solid"
},
{
"k": "text",
"id": "hint",
"x": 156,
"y": 900,
"w": 1608,
"h": 40,
"text": "{{f.hint}}",
"textSize": 12,
"color": "{{sh.faint}}",
"align": "Left",
"parent": "menu",
"bind": {
"text": "hint"
}
},
{
"k": "text",
"x": 466,
"y": 262,
"w": 56,
"h": 38,
"text": "FAV",
"textSize": 12,
"textColor": "{{sh.muted}}",
"align": "Center",
"parent": "browser"
},
{
"k": "group",
"id": "tester",
"x": 0,
"y": 0,
"visible": false,
"bind": {
"visible": "testerOn"
},
"parent": "menu"
},
{
"k": "container",
"x": 156,
"y": 232,
"w": 790,
"h": 300,
"fill": "Solid",
"bg": "{{sh.panel}}",
"bgAlpha": 1,
"parent": "tester"
},
{
"k": "container",
"x": 962,
"y": 232,
"w": 802,
"h": 460,
"fill": "Solid",
"bg": "{{sh.panel}}",
"bgAlpha": 1,
"parent": "tester"
},
{
"k": "container",
"x": 156,
"y": 548,
"w": 790,
"h": 144,
"fill": "Solid",
"bg": "{{sh.panel}}",
"bgAlpha": 1,
"parent": "tester"
},
{
"k": "container",
"x": 156,
"y": 708,
"w": 1608,
"h": 176,
"fill": "Solid",
"bg": "{{sh.panel}}",
"bgAlpha": 1,
"parent": "tester"
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.ink}}",
"parent": "tester",
"id": "mtTitle",
"x": 156,
"y": 240,
"w": 790,
"h": 36,
"text": "{{f.mtTitle}}",
"textSize": 18,
"bind": {
"text": "mtTitle"
}
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.ink}}",
"parent": "tester",
"x": 962,
"y": 240,
"w": 802,
"h": 36,
"text": "PARAMS",
"textSize": 18
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.ink}}",
"parent": "tester",
"x": 156,
"y": 554,
"w": 790,
"h": 30,
"text": "VOLUME",
"textSize": 18
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.ink}}",
"parent": "tester",
"x": 156,
"y": 716,
"w": 1608,
"h": 32,
"text": "LAST CALL",
"textSize": 16
},
{
"k": "group",
"id": "mtPkgArrows",
"x": 0,
"y": 0,
"visible": false,
"bind": {
"visible": "mtPkgArrows"
},
"parent": "tester"
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "mtPkgArrows",
"id": "mtPkgPrev",
"x": 196,
"y": 284,
"w": 80,
"h": 44,
"text": "<",
"textSize": 20,
"bg": "{{sh.orangeDim}}"
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "mtPkgArrows",
"id": "mtPkgNext",
"x": 866,
"y": 284,
"w": 80,
"h": 44,
"text": ">",
"textSize": 20,
"bg": "{{sh.orangeDim}}"
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.ink}}",
"parent": "tester",
"id": "mtPkg",
"x": 286,
"y": 284,
"w": 570,
"h": 44,
"text": "{{f.mtPkg}}",
"textSize": 20,
"bind": {
"text": "mtPkg"
}
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.ink}}",
"parent": "tester",
"id": "mtEvent",
"x": 196,
"y": 334,
"w": 750,
"h": 44,
"text": "{{f.mtEvent}}",
"textSize": 22,
"bind": {
"text": "mtEvent"
}
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.muted}}",
"parent": "tester",
"id": "mtEventIdx",
"x": 196,
"y": 378,
"w": 750,
"h": 22,
"text": "{{f.mtEventIdx}}",
"textSize": 13,
"bind": {
"text": "mtEventIdx"
}
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "tester",
"id": "mtPrev",
"x": 196,
"y": 406,
"w": 180,
"h": 60,
"text": "{{f.mtPrevLabel}}",
"textSize": 18,
"bg": "{{sh.row}}",
"bind": {
"text": "mtPrevLabel"
}
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "tester",
"id": "mtPlay",
"x": 386,
"y": 406,
"w": 180,
"h": 60,
"text": "{{f.mtPlayLabel}}",
"textSize": 18,
"bg": "{{sh.green}}",
"bind": {
"text": "mtPlayLabel"
}
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "tester",
"id": "mtStop",
"x": 576,
"y": 406,
"w": 180,
"h": 60,
"text": "{{f.mtStopLabel}}",
"textSize": 18,
"bg": "{{sh.redDim}}",
"bind": {
"text": "mtStopLabel"
}
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "tester",
"id": "mtNext",
"x": 766,
"y": 406,
"w": 180,
"h": 60,
"text": "{{f.mtNextLabel}}",
"textSize": 18,
"bg": "{{sh.row}}",
"bind": {
"text": "mtNextLabel"
}
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.muted}}",
"parent": "tester",
"id": "mtEventDesc",
"x": 196,
"y": 474,
"w": 750,
"h": 44,
"text": "{{f.mtEventDesc}}",
"textSize": 14,
"bind": {
"text": "mtEventDesc"
}
},
{
"k": "group",
"id": "mtP0",
"x": 0,
"y": 0,
"visible": false,
"bind": {
"visible": "mtP0On"
},
"parent": "tester"
},
{
"k": "text",
"textAlpha": 1,
"align": "Right",
"color": "{{sh.ink}}",
"parent": "mtP0",
"id": "mtP0Label",
"x": 978,
"y": 282,
"w": 330,
"h": 44,
"text": "{{f.mtP0Label}}",
"textSize": 17,
"bind": {
"text": "mtP0Label"
}
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.ink}}",
"parent": "mtP0",
"id": "mtP0Val",
"x": 1318,
"y": 282,
"w": 130,
"h": 44,
"text": "{{f.mtP0Val}}",
"textSize": 20,
"bind": {
"text": "mtP0Val"
}
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "mtP0",
"id": "mtP0Down",
"x": 1458,
"y": 282,
"w": 140,
"h": 44,
"text": "-",
"textSize": 20,
"bg": "{{sh.orangeDim}}"
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "mtP0",
"id": "mtP0Up",
"x": 1608,
"y": 282,
"w": 140,
"h": 44,
"text": "+",
"textSize": 20,
"bg": "{{sh.orangeDim}}"
},
{
"k": "text",
"textAlpha": 1,
"align": "Left",
"color": "{{sh.muted}}",
"parent": "mtP0",
"id": "mtP0Desc",
"x": 978,
"y": 328,
"w": 770,
"h": 26,
"text": "{{f.mtP0Desc}}",
"textSize": 13,
"bind": {
"text": "mtP0Desc"
}
},
{
"k": "group",
"id": "mtP1",
"x": 0,
"y": 0,
"visible": false,
"bind": {
"visible": "mtP1On"
},
"parent": "tester"
},
{
"k": "text",
"textAlpha": 1,
"align": "Right",
"color": "{{sh.ink}}",
"parent": "mtP1",
"id": "mtP1Label",
"x": 978,
"y": 360,
"w": 330,
"h": 44,
"text": "{{f.mtP1Label}}",
"textSize": 17,
"bind": {
"text": "mtP1Label"
}
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.ink}}",
"parent": "mtP1",
"id": "mtP1Val",
"x": 1318,
"y": 360,
"w": 130,
"h": 44,
"text": "{{f.mtP1Val}}",
"textSize": 20,
"bind": {
"text": "mtP1Val"
}
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "mtP1",
"id": "mtP1Down",
"x": 1458,
"y": 360,
"w": 140,
"h": 44,
"text": "-",
"textSize": 20,
"bg": "{{sh.orangeDim}}"
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "mtP1",
"id": "mtP1Up",
"x": 1608,
"y": 360,
"w": 140,
"h": 44,
"text": "+",
"textSize": 20,
"bg": "{{sh.orangeDim}}"
},
{
"k": "text",
"textAlpha": 1,
"align": "Left",
"color": "{{sh.muted}}",
"parent": "mtP1",
"id": "mtP1Desc",
"x": 978,
"y": 406,
"w": 770,
"h": 26,
"text": "{{f.mtP1Desc}}",
"textSize": 13,
"bind": {
"text": "mtP1Desc"
}
},
{
"k": "group",
"id": "mtP2",
"x": 0,
"y": 0,
"visible": false,
"bind": {
"visible": "mtP2On"
},
"parent": "tester"
},
{
"k": "text",
"textAlpha": 1,
"align": "Right",
"color": "{{sh.ink}}",
"parent": "mtP2",
"id": "mtP2Label",
"x": 978,
"y": 438,
"w": 330,
"h": 44,
"text": "{{f.mtP2Label}}",
"textSize": 17,
"bind": {
"text": "mtP2Label"
}
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.ink}}",
"parent": "mtP2",
"id": "mtP2Val",
"x": 1318,
"y": 438,
"w": 130,
"h": 44,
"text": "{{f.mtP2Val}}",
"textSize": 20,
"bind": {
"text": "mtP2Val"
}
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "mtP2",
"id": "mtP2Down",
"x": 1458,
"y": 438,
"w": 140,
"h": 44,
"text": "-",
"textSize": 20,
"bg": "{{sh.orangeDim}}"
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "mtP2",
"id": "mtP2Up",
"x": 1608,
"y": 438,
"w": 140,
"h": 44,
"text": "+",
"textSize": 20,
"bg": "{{sh.orangeDim}}"
},
{
"k": "text",
"textAlpha": 1,
"align": "Left",
"color": "{{sh.muted}}",
"parent": "mtP2",
"id": "mtP2Desc",
"x": 978,
"y": 484,
"w": 770,
"h": 26,
"text": "{{f.mtP2Desc}}",
"textSize": 13,
"bind": {
"text": "mtP2Desc"
}
},
{
"k": "group",
"id": "mtP3",
"x": 0,
"y": 0,
"visible": false,
"bind": {
"visible": "mtP3On"
},
"parent": "tester"
},
{
"k": "text",
"textAlpha": 1,
"align": "Right",
"color": "{{sh.ink}}",
"parent": "mtP3",
"id": "mtP3Label",
"x": 978,
"y": 516,
"w": 330,
"h": 44,
"text": "{{f.mtP3Label}}",
"textSize": 17,
"bind": {
"text": "mtP3Label"
}
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.ink}}",
"parent": "mtP3",
"id": "mtP3Val",
"x": 1318,
"y": 516,
"w": 130,
"h": 44,
"text": "{{f.mtP3Val}}",
"textSize": 20,
"bind": {
"text": "mtP3Val"
}
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "mtP3",
"id": "mtP3Down",
"x": 1458,
"y": 516,
"w": 140,
"h": 44,
"text": "-",
"textSize": 20,
"bg": "{{sh.orangeDim}}"
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "mtP3",
"id": "mtP3Up",
"x": 1608,
"y": 516,
"w": 140,
"h": 44,
"text": "+",
"textSize": 20,
"bg": "{{sh.orangeDim}}"
},
{
"k": "text",
"textAlpha": 1,
"align": "Left",
"color": "{{sh.muted}}",
"parent": "mtP3",
"id": "mtP3Desc",
"x": 978,
"y": 562,
"w": 770,
"h": 26,
"text": "{{f.mtP3Desc}}",
"textSize": 13,
"bind": {
"text": "mtP3Desc"
}
},
{
"k": "group",
"id": "mtP4",
"x": 0,
"y": 0,
"visible": false,
"bind": {
"visible": "mtP4On"
},
"parent": "tester"
},
{
"k": "text",
"textAlpha": 1,
"align": "Right",
"color": "{{sh.ink}}",
"parent": "mtP4",
"id": "mtP4Label",
"x": 978,
"y": 594,
"w": 330,
"h": 44,
"text": "{{f.mtP4Label}}",
"textSize": 17,
"bind": {
"text": "mtP4Label"
}
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.ink}}",
"parent": "mtP4",
"id": "mtP4Val",
"x": 1318,
"y": 594,
"w": 130,
"h": 44,
"text": "{{f.mtP4Val}}",
"textSize": 20,
"bind": {
"text": "mtP4Val"
}
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "mtP4",
"id": "mtP4Down",
"x": 1458,
"y": 594,
"w": 140,
"h": 44,
"text": "-",
"textSize": 20,
"bg": "{{sh.orangeDim}}"
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "mtP4",
"id": "mtP4Up",
"x": 1608,
"y": 594,
"w": 140,
"h": 44,
"text": "+",
"textSize": 20,
"bg": "{{sh.orangeDim}}"
},
{
"k": "text",
"textAlpha": 1,
"align": "Left",
"color": "{{sh.muted}}",
"parent": "mtP4",
"id": "mtP4Desc",
"x": 978,
"y": 640,
"w": 770,
"h": 26,
"text": "{{f.mtP4Desc}}",
"textSize": 13,
"bind": {
"text": "mtP4Desc"
}
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.muted}}",
"parent": "tester",
"id": "mtParamNote",
"x": 978,
"y": 666,
"w": 770,
"h": 24,
"text": "{{f.mtParamNote}}",
"textSize": 12,
"bind": {
"text": "mtParamNote"
}
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "tester",
"id": "mtVolDown",
"x": 196,
"y": 588,
"w": 200,
"h": 54,
"text": "-",
"textSize": 22,
"bg": "{{sh.orangeDim}}"
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.ink}}",
"parent": "tester",
"id": "mtVol",
"x": 406,
"y": 588,
"w": 330,
"h": 54,
"text": "{{f.mtVol}}",
"textSize": 26,
"bind": {
"text": "mtVol"
}
},
{
"k": "textbutton",
"bgAlpha": 1,
"align": "Center",
"textColor": "#FFFFFF",
"fill": "Solid",
"parent": "tester",
"id": "mtVolUp",
"x": 746,
"y": 588,
"w": 200,
"h": 54,
"text": "+",
"textSize": 22,
"bg": "{{sh.orangeDim}}"
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.muted}}",
"parent": "tester",
"x": 156,
"y": 648,
"w": 790,
"h": 30,
"text": "Multiplier: 0 = silent, 1 = normal, 3 = triple volume.",
"textSize": 13
},
{
"k": "group",
"id": "mtQueueGrp",
"x": 0,
"y": 0,
"visible": false,
"bind": {
"visible": "mtQueueOn"
},
"parent": "tester"
},
{
"k": "textbutton",
"y": 756,
"w": 260,
"h": 48,
"textSize": 15,
"textColor": "#FFFFFF",
"bgAlpha": 1,
"align": "Center",
"fill": "Solid",
"parent": "mtQueueGrp",
"id": "mtQueue",
"x": 466,
"text": "{{f.mtQueueLabel}}",
"bg": "{{sh.violet}}",
"bind": {
"text": "mtQueueLabel"
}
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.muted}}",
"parent": "mtQueueGrp",
"x": 466,
"y": 810,
"w": 260,
"h": 30,
"text": "Adds the track number to the queue.",
"textSize": 12
},
{
"k": "textbutton",
"y": 756,
"w": 260,
"h": 48,
"textSize": 15,
"textColor": "#FFFFFF",
"bgAlpha": 1,
"align": "Center",
"fill": "Solid",
"parent": "tester",
"id": "mtTarget",
"x": 1464,
"text": "{{f.mtTargetLabel}}",
"bg": "{{f.mtTargetBg}}",
"bind": {
"text": "mtTargetLabel",
"bg": "mtTargetBg"
}
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.muted}}",
"parent": "tester",
"x": 1464,
"y": 810,
"w": 260,
"h": 30,
"text": "ME: only you. EVERYONE: all players.",
"textSize": 12
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.green}}",
"parent": "tester",
"id": "mtLast",
"x": 736,
"y": 756,
"w": 718,
"h": 48,
"text": "{{f.mtLast}}",
"textSize": 20,
"bind": {
"text": "mtLast"
}
},
{
"k": "textbutton",
"y": 756,
"w": 260,
"h": 48,
"textSize": 15,
"textColor": "#FFFFFF",
"bgAlpha": 1,
"align": "Center",
"fill": "Solid",
"parent": "tester",
"id": "mtSave",
"x": 196,
"text": "SAVE TEMPLATE",
"bg": "{{sh.blue}}"
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.muted}}",
"parent": "tester",
"x": 196,
"y": 810,
"w": 260,
"h": 30,
"text": "Saves to FAVOURITES.",
"textSize": 12
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.muted}}",
"parent": "tester",
"x": 736,
"y": 810,
"w": 718,
"h": 30,
"text": "The last call sent. The game cannot report what is playing.",
"textSize": 12
},
{
"k": "text",
"textAlpha": 1,
"align": "Center",
"color": "{{sh.muted}}",
"parent": "tester",
"x": 196,
"y": 846,
"w": 1528,
"h": 30,
"text": "PLAY re-sends the package params and VOLUME before the event, so what you hear matches the numbers.",
"textSize": 13
},
{
"k": "group",
"id": "qrPanel",
"x": 0,
"y": 0,
"visible": false,
"bind": {
"visible": "qrOn"
}
},
{
"k": "container",
"x": 0,
"y": 0,
"w": 1920,
"h": 1080,
"fill": "Solid",
"bg": "{{sh.shell}}",
"bgAlpha": 0.98,
"parent": "qrPanel"
},
{
"k": "container",
"id": "qrSlot",
"x": 140,
"y": 60,
"w": 960,
"h": 960,
"fill": "Solid",
"bg": "#FFFFFF",
"bgAlpha": 1,
"parent": "qrPanel"
},
{
"k": "text",
"x": 1160,
"y": 96,
"w": 620,
"h": 96,
"text": "SCAN WITH YOUR PHONE CAMERA",
"textSize": 30,
"color": "{{sh.ink}}",
"align": "Left",
"wrap": true,
"parent": "qrPanel"
},
{
"k": "text",
"x": 1160,
"y": 200,
"w": 620,
"h": 120,
"text": "Your phone opens the SFX/VFX Showcase website with the full asset names. For a list in parts, scan each part.",
"textSize": 18,
"color": "{{sh.inkDim}}",
"align": "Left",
"wrap": true,
"parent": "qrPanel"
},
{
"k": "text",
"id": "qrPart",
"x": 1160,
"y": 350,
"w": 620,
"h": 56,
"text": "{{f.qrPart}}",
"textSize": 26,
"color": "{{sh.ink}}",
"align": "Left",
"parent": "qrPanel",
"bind": {
"text": "qrPart"
}
},
{
"k": "group",
"id": "qrNav",
"x": 0,
"y": 0,
"visible": false,
"parent": "qrPanel",
"bind": {
"visible": "qrNav"
}
},
{
"k": "textbutton",
"id": "btnQrPrev",
"x": 1160,
"y": 420,
"w": 150,
"h": 64,
"text": "<",
"textSize": 24,
"textColor": "{{sh.ink}}",
"bg": "{{sh.row}}",
"bgAlpha": 1,
"align": "Center",
"parent": "qrNav",
"fill": "Solid"
},
{
"k": "textbutton",
"id": "btnQrNext",
"x": 1320,
"y": 420,
"w": 150,
"h": 64,
"text": ">",
"textSize": 24,
"textColor": "{{sh.ink}}",
"bg": "{{sh.row}}",
"bgAlpha": 1,
"align": "Center",
"parent": "qrNav",
"fill": "Solid"
},
{
"k": "text",
"x": 1160,
"y": 520,
"w": 620,
"h": 140,
"text": "The code takes a few seconds to draw. If your phone does not pick it up, move closer or turn up the screen brightness.",
"textSize": 16,
"color": "{{sh.faint}}",
"align": "Left",
"wrap": true,
"parent": "qrPanel"
},
{
"k": "textbutton",
"id": "btnQrClose",
"x": 1160,
"y": 920,
"w": 400,
"h": 80,
"text": "CLOSE QR",
"textSize": 22,
"textColor": "{{sh.ink}}",
"bg": "{{sh.line}}",
"bgAlpha": 1,
"align": "Center",
"parent": "qrPanel",
"fill": "Solid"
}
];
export const ROW: readonly SceneNode[] = [
{
"k": "container",
"id": "bg",
"x": 0,
"y": 0,
"w": 1316,
"h": 58,
"fill": "Solid",
"bg": "{{r.bg}}",
"bgAlpha": 1,
"bind": {
"bg": "bg"
}
},
{
"k": "container",
"x": 0,
"y": 57,
"w": 1316,
"h": 1,
"fill": "Solid",
"bg": "{{sh.hairline}}",
"bgAlpha": 1
},
{
"k": "textbutton",
"id": "fav",
"x": 14,
"y": 13,
"w": 56,
"h": 32,
"text": "{{r.favLabel}}",
"textSize": 15,
"textColor": "{{r.favColor}}",
"bg": "{{r.favBg}}",
"bgAlpha": 1,
"align": "Center",
"fill": "Solid"
},
{
"k": "textbutton",
"id": "play",
"x": 78,
"y": 13,
"w": 90,
"h": 32,
"text": "{{r.playLabel}}",
"textSize": 14,
"textColor": "{{r.playColor}}",
"bg": "{{r.playBg}}",
"bgAlpha": 1,
"align": "Center",
"bind": {
"text": "playLabel",
"textColor": "playColor",
"bg": "playBg"
},
"fill": "Solid"
},
{
"k": "textbutton",
"id": "stop",
"x": 176,
"y": 13,
"w": 56,
"h": 32,
"text": "{{r.stopLabel}}",
"textSize": 11,
"textColor": "{{r.stopColor}}",
"bg": "{{r.stopBg}}",
"bgAlpha": 1,
"align": "Center",
"fill": "Solid"
},
{
"k": "text",
"x": 242,
"y": 0,
"w": 402,
"h": 58,
"text": "{{r.name}}",
"textSize": 18,
"color": "{{r.nameColor}}",
"align": "Left"
},
{
"k": "text",
"x": 656,
"y": 0,
"w": 230,
"h": 58,
"text": "{{r.category}}",
"textSize": 12,
"color": "{{sh.faint}}",
"align": "Left"
},
{
"k": "textbutton",
"id": "sel",
"x": 898,
"y": 11,
"w": 180,
"h": 36,
"text": "{{r.selLabel}}",
"textSize": 15,
"textColor": "{{r.selColor}}",
"bg": "{{r.selBg}}",
"bgAlpha": 1,
"align": "Center",
"bind": {
"text": "selLabel",
"textColor": "selColor",
"bg": "selBg"
},
"fill": "Solid"
},
{
"k": "container",
"x": 1090,
"y": 15,
"w": 76,
"h": 28,
"fill": "Blur",
"bg": "{{r.b1Bg}}",
"bgAlpha": 0.34,
"bind": {
"bg": "b1Bg"
}
},
{
"k": "text",
"x": 1090,
"y": 15,
"w": 76,
"h": 28,
"text": "{{r.b1}}",
"textSize": 12,
"color": "{{r.b1Color}}",
"align": "Center"
},
{
"k": "container",
"x": 1174,
"y": 15,
"w": 128,
"h": 28,
"fill": "Blur",
"bg": "{{r.b2Bg}}",
"bgAlpha": 0.34,
"bind": {
"bg": "b2Bg"
}
},
{
"k": "text",
"x": 1174,
"y": 15,
"w": 128,
"h": 28,
"text": "{{r.b2}}",
"textSize": 12,
"color": "{{r.b2Color}}",
"align": "Center"
}
];
export const KEYBOARD = {
"x": 452,
"y": 252,
"w": 1316,
"h": 500,
"x0": 468,
"keyW": 119,
"keyH": 62,
"gap": 10,
"queryY": 272,
"queryH": 56,
"rowY": [
360,
430,
500,
570
],
"rows": [
"1234567890",
"QWERTYUIOP",
"ASDFGHJKL-",
"ZXCVBNM.,_"
],
"prefixGrid": {
"x0": 468,
"cols": 8,
"rows": 7,
"w": 153,
"h": 36,
"gap": 6,
"rowY": [
350,
392,
434,
476,
518,
560,
602
],
"max": 56
},
"bottomY": 656,
"bottomH": 62,
"bottom": [
{
"action": "page",
"label": "PREFIXES",
"w": 280
},
{
"action": "spc",
"label": "SPACE",
"w": 330
},
{
"action": "bksp",
"label": "BACK",
"w": 170
},
{
"action": "clr",
"label": "CLEAR",
"w": 170
},
{
"action": "done",
"label": "DONE",
"w": 200
}
]
} as const;
export const FILTERS = {
"chipX": 460,
"chipY": 222,
"chipW": 124,
"chipH": 38,
"gap": 10,
"searchX": 1486,
"searchY": 222,
"searchW": 254,
"searchH": 38,
"sfx": [
{
"label": "ALL",
"key": "dim",
"val": ""
},
{
"label": "3D",
"key": "dim",
"val": "3d"
},
{
"label": "2D",
"key": "dim",
"val": "2d"
},
{
"label": "LOOP",
"key": "kind",
"val": "loop"
},
{
"label": "ONE",
"key": "kind",
"val": "oneshot"
}
],
"vfx": [
{
"label": "ALL",
"key": "vfx",
"val": ""
},
{
"label": "WORLD",
"key": "vfx",
"val": "world"
},
{
"label": "PLAYER",
"key": "vfx",
"val": "screen"
}
]
} as const;
export const CANVAS = {"w":1920,"h":1080} as const;
export const NODE_ACTIONS: readonly string[] = [
"bksp",
"btnAmpDown",
"btnAmpUp",
"btnClose",
"btnDebug",
"btnDeleteAll",
"btnNext",
"btnPrev",
"btnQr",
"btnQrClose",
"btnQrNext",
"btnQrPrev",
"btnRailNext",
"btnRailPrev",
"btnRngDown",
"btnRngUp",
"btnScaleDown",
"btnScaleUp",
"btnSelect",
"btnStopAll",
"btnUndo",
"clr",
"done",
"mtNext",
"mtP0Down",
"mtP0Up",
"mtP1Down",
"mtP1Up",
"mtP2Down",
"mtP2Up",
"mtP3Down",
"mtP3Up",
"mtP4Down",
"mtP4Up",
"mtPkgNext",
"mtPkgPrev",
"mtPlay",
"mtPrev",
"mtQueue",
"mtSave",
"mtStop",
"mtTarget",
"mtVolDown",
"mtVolUp",
"page",
"spc",
"tabFav",
"tabMusic",
"tabRadio",
"tabSfx",
"tabVfx"
];
// --- SOURCE: src\text.gen.ts ---
export const T = {
title: "sxS00",
tabSound: "sxS01",
tabVisual: "sxS02",
close: "sxS03",
group: "sxS04",
name: "sxS05",
action: "sxS06",
amplitude: "sxS07",
rangeM: "sxS08",
scaleWord: "sxS09",
undo: "sxS10",
deleteAll: "sxS11",
stopAll: "sxS12",
favouritesTab: "sxS13",
favColumn: "sxS14",
favAdd: "sxS15",
favRemove: "sxS16",
kindSfx: "sxS17",
kindVfx: "sxS18",
noFavourites: "sxS19",
exportFavs: "sxS20",
stop: "sxS21",
debugOn: "sxS22",
debugOff: "sxS23",
play: "sxS24",
railPrev: "sxS25",
railNext: "sxS26",
applyEffect: "sxS27",
space: "sxS28",
back: "sxS29",
clear: "sxS30",
done: "sxS31",
prefixes: "sxS32",
abcKeys: "sxS33",
search: "sxS34",
keyboardOpen: "sxS35",
minus: "sxS36",
plus: "sxS37",
playGlyph: "sxS38",
spawnGlyph: "sxS39",
effectGlyph: "sxS40",
chipAll: "sxS41",
chip3d: "sxS42",
chip2d: "sxS43",
chipLoop: "sxS44",
chipOne: "sxS45",
chipWorld: "sxS46",
chipPlayer: "sxS47",
nothingArmed: "sxS48",
selectAnItem: "sxS49",
selected: "sxS50",
select: "sxS51",
armedWord: "sxS52",
spatiality: "sxS53",
typeToSearch: "sxS54",
typeToSearchDot: "sxS55",
tapPrefix: "sxS56",
hintSearch: "sxS57",
hintClosed: "sxS58",
hintVfxPick: "sxS59",
hintVfxArmed: "sxS60",
hintSfxPick: "sxS61",
hintSfxArmed: "sxS62",
armFirst: "sxS63",
noSurface: "sxS64",
pickFirst: "sxS65",
nothingToUndo: "sxS66",
mtCardTrack: "sxS67",
mtCardRadio: "sxS68",
mtPrev: "sxS69",
mtNext: "sxS70",
mtPlay: "sxS71",
mtStop: "sxS72",
mtClearQueue: "sxS73",
mtNextTrack: "sxS74",
mtRadioLine: "sxS75",
mtNothingSent: "sxS76",
mtNoteParams: "sxS77",
mtNoParams: "sxS78",
hintMusic: "sxS79",
hintRadio: "sxS80",
mtTargetMe: "sxS81",
mtTargetAll: "sxS82",
mtRadioHelp: "sxS83",
mtQueueStale: "sxS84",
mtQueueEmpty: "sxS85",
kindMusic: "sxS86",
kindRadio: "sxS87",
tplOpen: "sxS88",
radioCh0: "sxS89",
radioCh1: "sxS90",
radioCh2: "sxS91",
radioCh3: "sxS92",
radioCh4: "sxS93",
radioCh5: "sxS94",
radioCh6: "sxS95",
radioBiome0: "sxS96",
radioBiome1: "sxS97",
radioBiome2: "sxS98",
radioBiome3: "sxS99",
radioBiome4: "sxS100",
radioBiome5: "sxS101",
radioBiome6: "sxS102",
screenVl7gas: "sxS103",
screenNight: "sxS104",
screenSaturated: "sxS105",
screenStealth: "sxS106",
catGas: "sxS107",
catScreen: "sxS108",
logEmpty: "sxS109",
charCursor: "sxS110",
onWord: "sxS111",
logBadMessage: "sxS112",
offWord: "sxS113",
} as const;
export const RADIO_TEXT = {
channels: ["Hip Hop", "Rock", "BF Themes", "Reggaeton", "Biome", "Classical", "Pop"],
biomes: ["Gibraltar", "Tajikistan", "Egypt", "US West Coast", "US East Coast", "Bulgaria", "Turkmenistan"],
} as const;
export const TPL = {
t1: "sxT114",
t2: "sxT115",
t3: "sxT116",
t4: "sxT117",
num1: "sxT118",
gap2: "sxT119",
armedOf: "sxT120",
itemsOf: "sxT121",
matchOf: "sxT122",
matchOf2: "sxT123",
pageOf: "sxT124",
qrPartOf: "sxT125",
railPageOf: "sxT126",
exportedN: "sxT127",
stoppedN: "sxT128",
scaleOf: "sxT129",
spawnedOf: "sxT130",
filters0: "sxT131",
filters1: "sxT132",
filters2: "sxT133",
filters3: "sxT134",
screenToggle: "sxT135",
mtPackageOf: "sxT136",
mtTrackOf: "sxT137",
mtParamLabel: "sxT138",
mtCallPlay: "sxT139",
mtCallParam: "sxT140",
mtCallLoad: "sxT141",
mtQueueOf: "sxT142",
mtTrackUnloaded: "sxT143",
mtTrackLoading: "sxT144",
mtRadioNote: "sxT145",
mtRadioNoteBiome: "sxT146",
tplMusicOf: "sxT147",
tplRadioOf: "sxT148",
mtQueueCount: "sxT149",
} as const;
export const CHAR_KEY: Readonly<Record<string, string>> = {
"0": "sxC154",
"1": "sxC155",
"2": "sxC156",
"3": "sxC157",
"4": "sxC158",
"5": "sxC159",
"6": "sxC160",
"7": "sxC161",
"8": "sxC162",
"9": "sxC163",
" ": "sxC150",
",": "sxC151",
"-": "sxC152",
".": "sxC153",
"A": "sxC164",
"B": "sxC165",
"C": "sxC166",
"D": "sxC167",
"E": "sxC168",
"F": "sxC169",
"G": "sxC170",
"H": "sxC171",
"I": "sxC172",
"J": "sxC173",
"K": "sxC174",
"L": "sxC175",
"M": "sxC176",
"N": "sxC177",
"O": "sxC178",
"P": "sxC179",
"Q": "sxC180",
"R": "sxC181",
"S": "sxC182",
"T": "sxC183",
"U": "sxC184",
"V": "sxC185",
"W": "sxC186",
"X": "sxC187",
"Y": "sxC188",
"Z": "sxC189",
"_": "sxC190",
};
export const SCENE_TEXT: Readonly<Record<string, string>> = {
"+": "sxN191",
"-": "sxN192",
"2D": "sxN193",
"3D": "sxN194",
"<": "sxN195",
"< GROUPS": "sxN196",
"< PREV": "sxN197",
">": "sxN198",
"ACTION": "sxN199",
"ALL": "sxN200",
"AMPLITUDE": "sxN201",
"Adds the track number to the queue.": "sxN202",
"BACK": "sxN203",
"CLEAR": "sxN204",
"CLOSE QR": "sxN205",
"CLOSE X": "sxN206",
"DELETE ALL": "sxN207",
"DONE": "sxN208",
"FAV": "sxN209",
"FAVOURITES": "sxN210",
"GROUP": "sxN211",
"GROUPS >": "sxN212",
"LAST CALL": "sxN213",
"LOOP": "sxN214",
"ME: only you. EVERYONE: all players.": "sxN215",
"MUSIC": "sxN216",
"Multiplier: 0 = silent, 1 = normal, 3 = triple volume.": "sxN217",
"NAME": "sxN218",
"NEXT >": "sxN219",
"ONE": "sxN220",
"PARAMS": "sxN221",
"PLAY re-sends the package params and VOLUME before the event, so what you hear matches the numbers.": "sxN222",
"PLAYER": "sxN223",
"PREFIXES": "sxN224",
"QR CODE": "sxN225",
"RADIO": "sxN226",
"RANGE m": "sxN227",
"SAVE TEMPLATE": "sxN228",
"SCALE": "sxN229",
"SCAN WITH YOUR PHONE CAMERA": "sxN230",
"SFX / VFX SHOWCASE": "sxN231",
"SOUND": "sxN232",
"SPACE": "sxN233",
"STOP ALL": "sxN234",
"Saves to FAVOURITES.": "sxN235",
"The code takes a few seconds to draw. If your phone does not pick it up, move closer or turn up the screen brightness.": "sxN236",
"The last call sent. The game cannot report what is playing.": "sxN237",
"UNDO": "sxN238",
"VISUAL": "sxN239",
"VOLUME": "sxN240",
"WORLD": "sxN241",
"Your phone opens the SFX/VFX Showcase website with the full asset names. For a list in parts, scan each part.": "sxN242",
"amp": "sxN243",
"applies to the selected effect": "sxN244",
"armed": "sxN245",
"headBadge": "sxN246",
"hint": "sxN247",
"mtEvent": "sxN248",
"mtEventDesc": "sxN249",
"mtEventIdx": "sxN250",
"mtLast": "sxN251",
"mtNextLabel": "sxN252",
"mtP0Desc": "sxN253",
"mtP0Label": "sxN254",
"mtP0Val": "sxN255",
"mtP1Desc": "sxN256",
"mtP1Label": "sxN257",
"mtP1Val": "sxN258",
"mtP2Desc": "sxN259",
"mtP2Label": "sxN260",
"mtP2Val": "sxN261",
"mtP3Desc": "sxN262",
"mtP3Label": "sxN263",
"mtP3Val": "sxN264",
"mtP4Desc": "sxN265",
"mtP4Label": "sxN266",
"mtP4Val": "sxN267",
"mtParamNote": "sxN268",
"mtPkg": "sxN269",
"mtPlayLabel": "sxN270",
"mtPrevLabel": "sxN271",
"mtQueueLabel": "sxN272",
"mtStopLabel": "sxN273",
"mtTargetLabel": "sxN274",
"mtTitle": "sxN275",
"mtVol": "sxN276",
"page": "sxN277",
"playLabel": "sxN278",
"qrPart": "sxN279",
"railSummary": "sxN280",
"rng": "sxN281",
"scale": "sxN282",
"selLabel": "sxN283",
"selectLabel": "sxN284",
"spawned": "sxN285",
};
export type StaticLabel = keyof typeof T;
// --- SOURCE: node_modules\bf6-portal-utils\ui\components\container\index.ts ---
export class UIContainer extends UI.Element implements UI.Parent {
public constructor(params: UIContainer.Params) {
super(params);
if (!this._isValid) return;
const parent = params.parent ?? UI.ROOT_NODE;
const receiver = this._receiver!;
const name = this._name;
const { x, y } = UI.Element._getPosition(params);
const { width, height } = UI.Element._getSize(params);
const anchor = params.anchor ?? UI.Anchor.Center;
const visible = params.visible ?? true;
const bgColor = params.bgColor ?? UI.COLORS.WHITE;
const bgAlpha = params.bgAlpha ?? 0;
const bgFill = params.bgFill ?? UI.BgFill.None;
const depth = params.depth ?? UI.Depth.AboveGameUI;
const nativeAnchor = UI.Element._getNativeAnchor(anchor);
const nativeBgFill = UI.Element._getNativeBgFill(bgFill);
const nativeDepth = UI.Element._getNativeDepth(depth);
if (!receiver.nativeReceiver) {
mod.AddUIContainer(
name,
mod.CreateVector(x, y, 0),
mod.CreateVector(width, height, 0),
nativeAnchor,
UI.Element._getNativeWidget(parent)!,
visible,
0,
Colors.toVector(bgColor),
bgAlpha,
nativeBgFill,
nativeDepth
);
} else {
mod.AddUIContainer(
name,
mod.CreateVector(x, y, 0),
mod.CreateVector(width, height, 0),
nativeAnchor,
UI.Element._getNativeWidget(parent)!,
visible,
0,
Colors.toVector(bgColor),
bgAlpha,
nativeBgFill,
nativeDepth,
receiver.nativeReceiver
);
}
this._bindNativeWidget(name);
for (const childParams of params.childrenParams ?? []) {
childParams.parent = this;
new childParams.type(childParams);
}
}
public get children(): readonly UI.Element[] | undefined {
if (!this._isValid) return undefined;
const list: UI.Element[] = [];
let curr = this._firstChild;
while (curr !== UI.Element._INVALID_INDEX) {
const inst = UI.Element._getInstance(curr);
if (inst) {
list.push(inst);
}
curr = UI.Element._getNextSibling(curr);
}
return list;
}
public getChild(index: number): UI.Element | null | undefined {
if (!this._isValid) return undefined;
if (index < 0) return null;
let curr = this._firstChild;
let idx = 0;
while (curr !== UI.Element._INVALID_INDEX) {
if (idx === index) return UI.Element._getInstance(curr) ?? null;
curr = UI.Element._getNextSibling(curr);
idx++;
}
return null;
}
public get childCount(): number | undefined {
if (!this._isValid) return undefined;
let count = 0;
let curr = this._firstChild;
while (curr !== UI.Element._INVALID_INDEX) {
count++;
curr = UI.Element._getNextSibling(curr);
}
return count;
}
public forEachChild(callback: (child: UI.Element, index: number) => void): void {
if (this._getIsInvalidAndLogWarning()) return;
let curr = this._firstChild;
let idx = 0;
while (curr !== UI.Element._INVALID_INDEX) {
const next = UI.Element._getNextSibling(curr);
const inst = UI.Element._getInstance(curr);
if (inst) {
CallbackHandler.invoke(
callback,
inst,
idx++,
undefined,
undefined,
UIContainer._logging,
'forEachChild'
);
}
curr = next;
}
}
}
export namespace UIContainer {
export type ChildParams<T extends UI.ElementParams = any> = T & {
type: new (params: T) => UI.Element;
};
export type Params = UI.ElementParams & {
childrenParams?: ChildParams<any>[];
};
}
// --- SOURCE: node_modules\bf6-portal-utils\ui\components\text\index.ts ---
export class UIText extends UI.Element {
protected static readonly _DIRTY_TEXT_LABEL = 1 << UI.Element._UNUSED_DIRTY_OFFSET;
protected static readonly _DIRTY_TEXT_ANCHOR = 1 << (UI.Element._UNUSED_DIRTY_OFFSET + 1);
protected static readonly _DIRTY_TEXT_SIZE = 1 << (UI.Element._UNUSED_DIRTY_OFFSET + 2);
protected static override readonly _UNUSED_DIRTY_OFFSET = UI.Element._UNUSED_DIRTY_OFFSET + 3;
private static readonly _labels = new Array<mod.Message | null>(UI.MAX_ELEMENTS);
private static readonly _textAnchor = new Uint8Array(UI.MAX_ELEMENTS);
private static readonly _textSize = new Float32Array(UI.MAX_ELEMENTS);
public constructor(params: UIText.Params) {
super(params);
if (!this._isValid) return;
const parent = params.parent ?? UI.ROOT_NODE;
const receiver = this._receiver!;
const name = this._name;
const { x, y } = UI.Element._getPosition(params);
const { width, height } = UI.Element._getSize(params);
const padding = params.padding ?? 0;
const anchor = params.anchor ?? UI.Anchor.Center;
const visible = params.visible ?? true;
const bgColor = params.bgColor ?? UI.COLORS.WHITE;
const bgAlpha = params.bgAlpha ?? 0;
const bgFill = params.bgFill ?? UI.BgFill.None;
const depth = params.depth ?? UI.Depth.AboveGameUI;
const textSize = params.textSize ?? 36;
const textColor = params.textColor ?? UI.COLORS.BLACK;
const textAlpha = params.textAlpha ?? 1;
const textAnchor = params.textAnchor ?? UI.Anchor.Center;
const nativeAnchor = UI.Element._getNativeAnchor(anchor);
const nativeBgFill = UI.Element._getNativeBgFill(bgFill);
const nativeDepth = UI.Element._getNativeDepth(depth);
const nativeTextAnchor = UI.Element._getNativeAnchor(textAnchor);
if (!receiver.nativeReceiver) {
mod.AddUIText(
name,
mod.CreateVector(x, y, 0),
mod.CreateVector(width, height, 0),
nativeAnchor,
UI.Element._getNativeWidget(parent)!,
visible,
padding,
Colors.toVector(bgColor),
bgAlpha,
nativeBgFill,
params.label,
textSize,
Colors.toVector(textColor),
textAlpha,
nativeTextAnchor,
nativeDepth
);
} else {
mod.AddUIText(
name,
mod.CreateVector(x, y, 0),
mod.CreateVector(width, height, 0),
nativeAnchor,
UI.Element._getNativeWidget(parent)!,
visible,
padding,
Colors.toVector(bgColor),
bgAlpha,
nativeBgFill,
params.label,
textSize,
Colors.toVector(textColor),
textAlpha,
nativeTextAnchor,
nativeDepth,
receiver.nativeReceiver
);
}
this._bindNativeWidget(name);
const slot = this._slot;
UIText._labels[slot] = params.label;
UIText._textAnchor[slot] = textAnchor;
UIText._textSize[slot] = textSize;
UI.Element._setPadding(slot, padding);
UI.Element._setForegroundAlpha(slot, textAlpha);
UI.Element._setForegroundColor(slot, textColor);
}
protected override _handleFlush(flags: number, widget: mod.UIWidget): void {
super._handleFlush(flags, widget);
const slot = this._slot;
if (flags & UIText._DIRTY_TEXT_LABEL) {
const label = UIText._labels[slot];
if (label) {
mod.SetUITextLabel(widget, label);
}
}
if (flags & UI.Element._DIRTY_FOREGROUND_COLOR) {
mod.SetUITextColor(widget, Colors.toVector(UI.Element._getForegroundColor(slot)));
}
if (flags & UI.Element._DIRTY_FOREGROUND_ALPHA) {
mod.SetUITextAlpha(widget, UI.Element._getForegroundAlpha(slot));
}
if (flags & UIText._DIRTY_TEXT_ANCHOR) {
mod.SetUITextAnchor(widget, UI.Element._getNativeAnchor(UIText._textAnchor[slot] as UI.Anchor));
}
if (flags & UIText._DIRTY_TEXT_SIZE) {
mod.SetUITextSize(widget, UIText._textSize[slot]);
}
}
public override delete(): void {
const slot = this._getSlotAndLogWarning();
if (slot === UI.Element._INVALID_INDEX) return;
UIText._labels[slot] = null;
UIText._textAnchor[slot] = 0;
UIText._textSize[slot] = 0;
super.delete();
}
public get label(): mod.Message | undefined {
const slot = this._slot;
return slot === UI.Element._INVALID_INDEX ? undefined : (UIText._labels[slot] ?? undefined);
}
public set label(label: mod.Message) {
this.setLabel(label);
}
public setLabel(label: mod.Message): this {
const slot = this._getSlotAndLogWarning();
if (slot === UI.Element._INVALID_INDEX) return this;
if (UIText._labels[slot] === label) return this;
UIText._labels[slot] = label;
UI.Element._markDirty(slot, UIText._DIRTY_TEXT_LABEL);
return this;
}
public get textAlpha(): number | undefined {
const slot = this._slot;
return slot === UI.Element._INVALID_INDEX ? undefined : UI.Element._getForegroundAlpha(slot);
}
public set textAlpha(alpha: number) {
this.setTextAlpha(alpha);
}
public setTextAlpha(alpha: number): this {
const slot = this._getSlotAndLogWarning();
if (slot === UI.Element._INVALID_INDEX) return this;
if (UI.Element._setForegroundAlpha(slot, alpha)) {
UI.Element._markDirty(slot, UI.Element._DIRTY_FOREGROUND_ALPHA);
}
return this;
}
public get textAnchor(): UI.Anchor | undefined {
const slot = this._slot;
return slot === UI.Element._INVALID_INDEX ? undefined : (UIText._textAnchor[slot] as UI.Anchor);
}
public set textAnchor(anchor: UI.Anchor) {
this.setTextAnchor(anchor);
}
public setTextAnchor(anchor: UI.Anchor): this {
const slot = this._getSlotAndLogWarning();
if (slot === UI.Element._INVALID_INDEX) return this;
if (UIText._textAnchor[slot] === anchor) return this;
UIText._textAnchor[slot] = anchor;
UI.Element._markDirty(slot, UIText._DIRTY_TEXT_ANCHOR);
return this;
}
public get textColor(): Colors.Color | undefined {
const slot = this._slot;
return slot === UI.Element._INVALID_INDEX ? undefined : UI.Element._getForegroundColor(slot);
}
public getTextColor(out?: Colors.Color): Colors.Color | undefined {
const slot = this._slot;
return slot === UI.Element._INVALID_INDEX ? undefined : UI.Element._getForegroundColor(slot, out);
}
public set textColor(color: Colors.Color) {
this.setTextColor(color);
}
public setTextColor(color: Colors.Color): this {
const slot = this._getSlotAndLogWarning();
if (slot === UI.Element._INVALID_INDEX) return this;
if (UI.Element._setForegroundColor(slot, color)) {
UI.Element._markDirty(slot, UI.Element._DIRTY_FOREGROUND_COLOR);
}
return this;
}
public get textSize(): number | undefined {
const slot = this._slot;
return slot === UI.Element._INVALID_INDEX ? undefined : UIText._textSize[slot];
}
public set textSize(size: number) {
this.setTextSize(size);
}
public setTextSize(size: number): this {
const slot = this._getSlotAndLogWarning();
if (slot === UI.Element._INVALID_INDEX) return this;
if (UIText._textSize[slot] === size) return this;
UIText._textSize[slot] = size;
UI.Element._markDirty(slot, UIText._DIRTY_TEXT_SIZE);
return this;
}
public get padding(): number | undefined {
const slot = this._slot;
return slot === UI.Element._INVALID_INDEX ? undefined : UI.Element._getPadding(slot);
}
public set padding(padding: number) {
this.setPadding(padding);
}
public setPadding(padding: number): this {
const slot = this._getSlotAndLogWarning();
if (slot === UI.Element._INVALID_INDEX) return this;
if (UI.Element._getPadding(slot) === padding) return this;
UI.Element._setPadding(slot, padding);
UI.Element._markDirty(slot, UI.Element._DIRTY_PADDING);
return this;
}
}
export namespace UIText {
export type Params = UI.ElementParams & {
label: mod.Message;
textSize?: number;
textColor?: Colors.Color;
textAlpha?: number;
textAnchor?: UI.Anchor;
padding?: number;
};
}
// --- SOURCE: node_modules\bf6-portal-utils\ui\components\base-button\index.ts ---
export abstract class UIBaseButton extends UI.Element {
protected static readonly _DIRTY_BTN_ENABLED = 1 << UI.Element._UNUSED_DIRTY_OFFSET;
protected static readonly _DIRTY_BTN_DISABLED_COLOR = 1 << (UI.Element._UNUSED_DIRTY_OFFSET + 1);
protected static readonly _DIRTY_BTN_DISABLED_ALPHA = 1 << (UI.Element._UNUSED_DIRTY_OFFSET + 2);
protected static readonly _DIRTY_BTN_PRESSED_COLOR = 1 << (UI.Element._UNUSED_DIRTY_OFFSET + 3);
protected static readonly _DIRTY_BTN_PRESSED_ALPHA = 1 << (UI.Element._UNUSED_DIRTY_OFFSET + 4);
protected static readonly _DIRTY_BTN_FOCUSED_COLOR = 1 << (UI.Element._UNUSED_DIRTY_OFFSET + 5);
protected static readonly _DIRTY_BTN_FOCUSED_ALPHA = 1 << (UI.Element._UNUSED_DIRTY_OFFSET + 6);
protected static override readonly _UNUSED_DIRTY_OFFSET = UI.Element._UNUSED_DIRTY_OFFSET + 7;
public static readonly MAX_BUTTONS = 512;
protected static readonly _MAX_GENERATIONS = 65_535;
protected static _activeButtonCount: number = 0;
protected static _firstFreeButton: number = 0;
protected static readonly _generations = new Uint16Array(UIBaseButton.MAX_BUTTONS);
protected static readonly _nextFreeButton = new Int16Array(UIBaseButton.MAX_BUTTONS);
protected static readonly _elementToButtonSlot: Int16Array = UI.Element._elementToCustomSlot;
protected static readonly _buttonOnClickUp = new Array<UI.ButtonHandler | null>(UIBaseButton.MAX_BUTTONS);
protected static readonly _buttonOnClickDown = new Array<UI.ButtonHandler | null>(UIBaseButton.MAX_BUTTONS);
protected static readonly _buttonOnFocusIn = new Array<UI.ButtonHandler | null>(UIBaseButton.MAX_BUTTONS);
protected static readonly _buttonOnFocusOut = new Array<UI.ButtonHandler | null>(UIBaseButton.MAX_BUTTONS);
protected static readonly _disabledRgba = new Uint32Array(UIBaseButton.MAX_BUTTONS);
protected static readonly _pressedRgba = new Uint32Array(UIBaseButton.MAX_BUTTONS);
protected static readonly _focusedRgba = new Uint32Array(UIBaseButton.MAX_BUTTONS);
protected static _unpackColor(rgba: number, out?: Colors.Color): Colors.Color {
const r = (rgba >>> 24) / 255;
const g = ((rgba >>> 16) & 0xff) / 255;
const b = ((rgba >>> 8) & 0xff) / 255;
if (out) {
out.r = r;
out.g = g;
out.b = b;
return out;
}
return { r, g, b };
}
protected static _unpackAlpha(rgba: number): number {
return (rgba & 0xff) / 255;
}
protected static _setRgb(array: Uint32Array, slot: number, color: Colors.Color): boolean {
const rInt = Math.min(Math.max(Math.round(color.r * 255), 0), 255);
const gInt = Math.min(Math.max(Math.round(color.g * 255), 0), 255);
const bInt = Math.min(Math.max(Math.round(color.b * 255), 0), 255);
const currentRgba = array[slot];
const newRgba = ((rInt << 24) | (gInt << 16) | (bInt << 8) | (currentRgba & 0xff)) >>> 0;
if (newRgba === currentRgba) return false;
array[slot] = newRgba;
return true;
}
protected static _setAlpha(array: Uint32Array, slot: number, alpha: number): boolean {
const aInt = Math.min(Math.max(Math.round(alpha * 255), 0), 255);
const currentRgba = array[slot];
const newRgba = ((currentRgba & ~0xff) | aInt) >>> 0;
if (newRgba === currentRgba) return false;
array[slot] = newRgba;
return true;
}
static {
for (let i = 0; i < UIBaseButton.MAX_BUTTONS - 1; ++i) {
UIBaseButton._nextFreeButton[i] = i + 1;
}
UIBaseButton._nextFreeButton[UIBaseButton.MAX_BUTTONS - 1] = UIBaseButton._INVALID_INDEX;
UIBaseButton._generations.fill(0);
UIBaseButton._buttonOnClickUp.fill(null);
UIBaseButton._buttonOnClickDown.fill(null);
UIBaseButton._buttonOnFocusIn.fill(null);
UIBaseButton._buttonOnFocusOut.fill(null);
UIBaseButton._elementToButtonSlot.fill(UIBaseButton._INVALID_INDEX);
Events.OnPlayerUIButtonEvent.subscribe(UIBaseButton._handleButtonEvent);
}
protected override _handleFlush(flags: number, widget: mod.UIWidget): void {
super._handleFlush(flags, widget);
const slot = this._slot;
const btnSlot = UIBaseButton._elementToButtonSlot[slot];
if (btnSlot === UIBaseButton._INVALID_INDEX) return;
const btnWidget = this._buttonUIWidget ?? widget;
if (!btnWidget) return;
if (flags & UIBaseButton._DIRTY_BTN_ENABLED) {
mod.SetUIButtonEnabled(btnWidget, UI.Element._isEnabled(slot));
}
if (flags & UI.Element._DIRTY_FOREGROUND_COLOR) {
mod.SetUIButtonColorBase(btnWidget, Colors.toVector(UI.Element._getForegroundColor(slot)));
}
if (flags & UI.Element._DIRTY_FOREGROUND_ALPHA) {
mod.SetUIButtonAlphaBase(btnWidget, UI.Element._getForegroundAlpha(slot));
}
if (flags & UIBaseButton._DIRTY_BTN_DISABLED_COLOR) {
mod.SetUIButtonColorDisabled(
btnWidget,
Colors.toVector(UIBaseButton._unpackColor(UIBaseButton._disabledRgba[btnSlot]))
);
}
if (flags & UIBaseButton._DIRTY_BTN_DISABLED_ALPHA) {
mod.SetUIButtonAlphaDisabled(btnWidget, UIBaseButton._unpackAlpha(UIBaseButton._disabledRgba[btnSlot]));
}
if (flags & UIBaseButton._DIRTY_BTN_PRESSED_COLOR) {
mod.SetUIButtonColorPressed(
btnWidget,
Colors.toVector(UIBaseButton._unpackColor(UIBaseButton._pressedRgba[btnSlot]))
);
}
if (flags & UIBaseButton._DIRTY_BTN_PRESSED_ALPHA) {
mod.SetUIButtonAlphaPressed(btnWidget, UIBaseButton._unpackAlpha(UIBaseButton._pressedRgba[btnSlot]));
}
if (flags & UIBaseButton._DIRTY_BTN_FOCUSED_COLOR) {
mod.SetUIButtonColorFocused(
btnWidget,
Colors.toVector(UIBaseButton._unpackColor(UIBaseButton._focusedRgba[btnSlot]))
);
}
if (flags & UIBaseButton._DIRTY_BTN_FOCUSED_ALPHA) {
mod.SetUIButtonAlphaFocused(btnWidget, UIBaseButton._unpackAlpha(UIBaseButton._focusedRgba[btnSlot]));
}
}
public static getActiveButtonCount(): number {
return UIBaseButton._activeButtonCount;
}
protected static _resolveButtonSlot(elementId: number): number {
const elementSlot = UI.Element._resolveSlot(elementId);
if (elementSlot === UI.Element._INVALID_INDEX) return UIBaseButton._INVALID_INDEX;
return UIBaseButton._elementToButtonSlot[elementSlot];
}
private static _handleButtonEvent(player: mod.Player, widget: mod.UIWidget, event: mod.UIButtonEvent): void {
const name = mod.GetUIWidgetName(widget);
const match = /^ui_(\d+)/.exec(name);
const elementId = match ? parseInt(match[1], 10) : NaN;
if (isNaN(elementId) || elementId <= 0) return;
const slot = UIBaseButton._resolveButtonSlot(elementId);
if (slot === UIBaseButton._INVALID_INDEX) {
UIBaseButton._logging.log(`Button ${name} not found or slot unassigned`, UI.LogLevel.Warning);
return;
}
let handler: UI.ButtonHandler | null = null;
if (mod.Equals(event, mod.UIButtonEvent.ButtonUp)) {
handler = UIBaseButton._buttonOnClickUp[slot];
if (!handler) {
UIBaseButton._logging.log(`Button ${name} has no onClickUp handler`, UI.LogLevel.Warning);
return;
}
} else if (mod.Equals(event, mod.UIButtonEvent.ButtonDown)) {
handler = UIBaseButton._buttonOnClickDown[slot];
if (!handler) {
UIBaseButton._logging.log(`Button ${name} has no onClickDown handler`, UI.LogLevel.Warning);
return;
}
} else if (mod.Equals(event, mod.UIButtonEvent.FocusIn)) {
handler = UIBaseButton._buttonOnFocusIn[slot];
if (!handler) {
UIBaseButton._logging.log(`Button ${name} has no onFocusIn handler`, UI.LogLevel.Warning);
return;
}
} else if (mod.Equals(event, mod.UIButtonEvent.FocusOut)) {
handler = UIBaseButton._buttonOnFocusOut[slot];
if (!handler) {
UIBaseButton._logging.log(`Button ${name} has no onFocusOut handler`, UI.LogLevel.Warning);
return;
}
}
if (!handler) {
UIBaseButton._logging.log('HoverIn and HoverOut button events not supported', UI.LogLevel.Warning);
return;
}
CallbackHandler.invoke(handler, player, undefined, undefined, undefined, UIBaseButton._logging, 'buttonEvent');
}
private _allocateButtonSlot(): number {
const elementSlot = this._slot;
if (elementSlot < 0 || elementSlot >= UI.MAX_ELEMENTS) return UIBaseButton._INVALID_INDEX;
if (UIBaseButton._firstFreeButton === UIBaseButton._INVALID_INDEX) {
UIBaseButton._logging.log('Button pool is full', UI.LogLevel.Error);
return UIBaseButton._INVALID_INDEX;
}
const slot = UIBaseButton._firstFreeButton;
UIBaseButton._firstFreeButton = UIBaseButton._nextFreeButton[slot];
UIBaseButton._nextFreeButton[slot] = UIBaseButton._INVALID_INDEX;
UIBaseButton._buttonOnClickUp[slot] = null;
UIBaseButton._buttonOnClickDown[slot] = null;
UIBaseButton._buttonOnFocusIn[slot] = null;
UIBaseButton._buttonOnFocusOut[slot] = null;
UI.Element._setEnabled(elementSlot, true);
UIBaseButton._elementToButtonSlot[elementSlot] = slot;
UIBaseButton._activeButtonCount++;
return slot;
}
private _freeButtonSlot(): void {
const elementSlot = this._slot;
if (elementSlot < 0 || elementSlot >= UI.MAX_ELEMENTS) return;
const slot = UIBaseButton._elementToButtonSlot[elementSlot];
if (slot === UIBaseButton._INVALID_INDEX || slot < 0 || slot >= UIBaseButton.MAX_BUTTONS) return;
UIBaseButton._buttonOnClickUp[slot] = null;
UIBaseButton._buttonOnClickDown[slot] = null;
UIBaseButton._buttonOnFocusIn[slot] = null;
UIBaseButton._buttonOnFocusOut[slot] = null;
UIBaseButton._disabledRgba[slot] = 0;
UIBaseButton._pressedRgba[slot] = 0;
UIBaseButton._focusedRgba[slot] = 0;
UI.Element._setEnabled(elementSlot, false);
UIBaseButton._elementToButtonSlot[elementSlot] = UIBaseButton._INVALID_INDEX;
UIBaseButton._activeButtonCount--;
if (UIBaseButton._generations[slot] < UIBaseButton._MAX_GENERATIONS) {
UIBaseButton._generations[slot]++;
UIBaseButton._nextFreeButton[slot] = UIBaseButton._firstFreeButton;
UIBaseButton._firstFreeButton = slot;
} else if (UIBaseButton._logging.willLog(UI.LogLevel.Warning)) {
UIBaseButton._logging.log(
`Button slot ${slot} exhausted max generations and was retired`,
UI.LogLevel.Warning
);
}
}
protected get _buttonUIWidget(): mod.UIWidget | null {
return this._uiWidget;
}
protected get _buttonSlot(): number {
const slot = this._slot;
return slot !== UI.Element._INVALID_INDEX
? UIBaseButton._elementToButtonSlot[slot]
: UIBaseButton._INVALID_INDEX;
}
protected override get _isValid(): boolean {
return this._buttonSlot !== UIBaseButton._INVALID_INDEX;
}
protected _resolveButtonSlotAndLogWarning(): number {
const elementSlot = this._getSlotAndLogWarning();
if (elementSlot === UI.Element._INVALID_INDEX) return UIBaseButton._INVALID_INDEX;
const btnSlot = UIBaseButton._elementToButtonSlot[elementSlot];
if (btnSlot === UIBaseButton._INVALID_INDEX) {
UIBaseButton._logging.log(`Button is deleted`, UI.LogLevel.Warning);
return UIBaseButton._INVALID_INDEX;
}
return btnSlot;
}
protected override _getIsInvalidAndLogWarning(): boolean {
return this._resolveButtonSlotAndLogWarning() === UIBaseButton._INVALID_INDEX;
}
protected _getButtonHandler(event: UIBaseButton.Event): UI.ButtonHandler | null | undefined {
const btnSlot = this._buttonSlot;
if (btnSlot === UIBaseButton._INVALID_INDEX) return undefined;
switch (event) {
case UIBaseButton.Event.ClickUp:
return UIBaseButton._buttonOnClickUp[btnSlot] ?? null;
case UIBaseButton.Event.ClickDown:
return UIBaseButton._buttonOnClickDown[btnSlot] ?? null;
case UIBaseButton.Event.FocusIn:
return UIBaseButton._buttonOnFocusIn[btnSlot] ?? null;
case UIBaseButton.Event.FocusOut:
return UIBaseButton._buttonOnFocusOut[btnSlot] ?? null;
default:
return undefined;
}
}
protected _setButtonHandler(event: UIBaseButton.Event, handler?: UI.ButtonHandler | null): void {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return;
const buttonWidget = this._buttonUIWidget;
if (!buttonWidget) return;
let prev: UI.ButtonHandler | null = null;
let nativeEvent: mod.UIButtonEvent;
switch (event) {
case UIBaseButton.Event.ClickUp:
prev = UIBaseButton._buttonOnClickUp[btnSlot];
UIBaseButton._buttonOnClickUp[btnSlot] = handler ?? null;
nativeEvent = mod.UIButtonEvent.ButtonUp;
break;
case UIBaseButton.Event.ClickDown:
prev = UIBaseButton._buttonOnClickDown[btnSlot];
UIBaseButton._buttonOnClickDown[btnSlot] = handler ?? null;
nativeEvent = mod.UIButtonEvent.ButtonDown;
break;
case UIBaseButton.Event.FocusIn:
prev = UIBaseButton._buttonOnFocusIn[btnSlot];
UIBaseButton._buttonOnFocusIn[btnSlot] = handler ?? null;
nativeEvent = mod.UIButtonEvent.FocusIn;
break;
case UIBaseButton.Event.FocusOut:
prev = UIBaseButton._buttonOnFocusOut[btnSlot];
UIBaseButton._buttonOnFocusOut[btnSlot] = handler ?? null;
nativeEvent = mod.UIButtonEvent.FocusOut;
break;
default:
return;
}
if (handler && !prev) {
mod.EnableUIButtonEvent(buttonWidget, nativeEvent, true);
} else if (!handler && prev) {
mod.EnableUIButtonEvent(buttonWidget, nativeEvent, false);
}
}
protected _setupButtonHandlers(params: UIBaseButton.Params): void {
const btnSlot = this._buttonSlot;
if (btnSlot === UIBaseButton._INVALID_INDEX) return;
const buttonWidget = this._buttonUIWidget;
if (!buttonWidget) return;
if (params.onClickDown) {
UIBaseButton._buttonOnClickDown[btnSlot] = params.onClickDown;
mod.EnableUIButtonEvent(buttonWidget, mod.UIButtonEvent.ButtonDown, true);
} else {
mod.EnableUIButtonEvent(buttonWidget, mod.UIButtonEvent.ButtonDown, false);
}
if (params.onClickUp) {
UIBaseButton._buttonOnClickUp[btnSlot] = params.onClickUp;
mod.EnableUIButtonEvent(buttonWidget, mod.UIButtonEvent.ButtonUp, true);
}
if (params.onFocusIn) {
UIBaseButton._buttonOnFocusIn[btnSlot] = params.onFocusIn;
mod.EnableUIButtonEvent(buttonWidget, mod.UIButtonEvent.FocusIn, true);
}
if (params.onFocusOut) {
UIBaseButton._buttonOnFocusOut[btnSlot] = params.onFocusOut;
mod.EnableUIButtonEvent(buttonWidget, mod.UIButtonEvent.FocusOut, true);
}
}
protected constructor(params?: UIBaseButton.Params) {
super(params);
if (!params || this._slot === UI.Element._INVALID_INDEX) return;
if (this._allocateButtonSlot() !== UIBaseButton._INVALID_INDEX) return;
this.delete();
}
public override delete(): void {
if (this._getIsInvalidAndLogWarning()) return;
this._freeButtonSlot();
super.delete();
}
public get onClickUp(): UI.ButtonHandler | null | undefined {
return this._isValid ? this._getButtonHandler(UIBaseButton.Event.ClickUp) : undefined;
}
public set onClickUp(handler: UI.ButtonHandler | null) {
this.setOnClickUp(handler);
}
public setOnClickUp(handler?: UI.ButtonHandler | null): this {
if (this._getIsInvalidAndLogWarning()) return this;
this._setButtonHandler(UIBaseButton.Event.ClickUp, handler);
return this;
}
public get onClickDown(): UI.ButtonHandler | null | undefined {
return this._isValid ? this._getButtonHandler(UIBaseButton.Event.ClickDown) : undefined;
}
public set onClickDown(handler: UI.ButtonHandler | null) {
this.setOnClickDown(handler);
}
public setOnClickDown(handler?: UI.ButtonHandler | null): this {
if (this._getIsInvalidAndLogWarning()) return this;
this._setButtonHandler(UIBaseButton.Event.ClickDown, handler);
return this;
}
public get onFocusIn(): UI.ButtonHandler | null | undefined {
return this._isValid ? this._getButtonHandler(UIBaseButton.Event.FocusIn) : undefined;
}
public set onFocusIn(handler: UI.ButtonHandler | null) {
this.setOnFocusIn(handler);
}
public setOnFocusIn(handler?: UI.ButtonHandler | null): this {
if (this._getIsInvalidAndLogWarning()) return this;
this._setButtonHandler(UIBaseButton.Event.FocusIn, handler);
return this;
}
public get onFocusOut(): UI.ButtonHandler | null | undefined {
return this._isValid ? this._getButtonHandler(UIBaseButton.Event.FocusOut) : undefined;
}
public set onFocusOut(handler: UI.ButtonHandler | null) {
this.setOnFocusOut(handler);
}
public setOnFocusOut(handler?: UI.ButtonHandler | null): this {
if (this._getIsInvalidAndLogWarning()) return this;
this._setButtonHandler(UIBaseButton.Event.FocusOut, handler);
return this;
}
protected _setContentEnabled(_enabled: boolean): void {}
public get enabled(): boolean | undefined {
const slot = this._slot;
return slot !== UI.Element._INVALID_INDEX ? UI.Element._isEnabled(slot) : undefined;
}
public set enabled(enabled: boolean) {
this.setEnabled(enabled);
}
public setEnabled(enabled: boolean): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
const slot = this._slot;
if (UI.Element._isEnabled(slot) === enabled) return this;
UI.Element._setEnabled(slot, enabled);
this._setContentEnabled(enabled);
UI.Element._markDirty(slot, UIBaseButton._DIRTY_BTN_ENABLED);
return this;
}
public get baseColor(): Colors.Color | undefined {
const slot = this._slot;
return slot === UI.Element._INVALID_INDEX ? undefined : UI.Element._getForegroundColor(slot);
}
public getBaseColor(out?: Colors.Color): Colors.Color | undefined {
const slot = this._slot;
return slot === UI.Element._INVALID_INDEX ? undefined : UI.Element._getForegroundColor(slot, out);
}
public set baseColor(color: Colors.Color) {
this.setBaseColor(color);
}
public setBaseColor(color: Colors.Color): this {
const slot = this._getSlotAndLogWarning();
if (slot === UI.Element._INVALID_INDEX) return this;
if (UI.Element._setForegroundColor(slot, color)) {
UI.Element._markDirty(slot, UI.Element._DIRTY_FOREGROUND_COLOR);
}
return this;
}
public get baseAlpha(): number | undefined {
const slot = this._slot;
return slot === UI.Element._INVALID_INDEX ? undefined : UI.Element._getForegroundAlpha(slot);
}
public set baseAlpha(alpha: number) {
this.setBaseAlpha(alpha);
}
public setBaseAlpha(alpha: number): this {
const slot = this._getSlotAndLogWarning();
if (slot === UI.Element._INVALID_INDEX) return this;
if (UI.Element._setForegroundAlpha(slot, alpha)) {
UI.Element._markDirty(slot, UI.Element._DIRTY_FOREGROUND_ALPHA);
}
return this;
}
public get disabledColor(): Colors.Color | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackColor(UIBaseButton._disabledRgba[btnSlot]);
}
public getDisabledColor(out?: Colors.Color): Colors.Color | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackColor(UIBaseButton._disabledRgba[btnSlot], out);
}
public set disabledColor(color: Colors.Color) {
this.setDisabledColor(color);
}
public setDisabledColor(color: Colors.Color): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
if (UIBaseButton._setRgb(UIBaseButton._disabledRgba, btnSlot, color)) {
UI.Element._markDirty(this._slot, UIBaseButton._DIRTY_BTN_DISABLED_COLOR);
}
return this;
}
public get disabledAlpha(): number | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackAlpha(UIBaseButton._disabledRgba[btnSlot]);
}
public set disabledAlpha(alpha: number) {
this.setDisabledAlpha(alpha);
}
public setDisabledAlpha(alpha: number): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
if (UIBaseButton._setAlpha(UIBaseButton._disabledRgba, btnSlot, alpha)) {
UI.Element._markDirty(this._slot, UIBaseButton._DIRTY_BTN_DISABLED_ALPHA);
}
return this;
}
public get pressedColor(): Colors.Color | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackColor(UIBaseButton._pressedRgba[btnSlot]);
}
public getPressedColor(out?: Colors.Color): Colors.Color | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackColor(UIBaseButton._pressedRgba[btnSlot], out);
}
public set pressedColor(color: Colors.Color) {
this.setPressedColor(color);
}
public setPressedColor(color: Colors.Color): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
if (UIBaseButton._setRgb(UIBaseButton._pressedRgba, btnSlot, color)) {
UI.Element._markDirty(this._slot, UIBaseButton._DIRTY_BTN_PRESSED_COLOR);
}
return this;
}
public get pressedAlpha(): number | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackAlpha(UIBaseButton._pressedRgba[btnSlot]);
}
public set pressedAlpha(alpha: number) {
this.setPressedAlpha(alpha);
}
public setPressedAlpha(alpha: number): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
if (UIBaseButton._setAlpha(UIBaseButton._pressedRgba, btnSlot, alpha)) {
UI.Element._markDirty(this._slot, UIBaseButton._DIRTY_BTN_PRESSED_ALPHA);
}
return this;
}
public get focusedColor(): Colors.Color | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackColor(UIBaseButton._focusedRgba[btnSlot]);
}
public getFocusedColor(out?: Colors.Color): Colors.Color | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackColor(UIBaseButton._focusedRgba[btnSlot], out);
}
public set focusedColor(color: Colors.Color) {
this.setFocusedColor(color);
}
public setFocusedColor(color: Colors.Color): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
if (UIBaseButton._setRgb(UIBaseButton._focusedRgba, btnSlot, color)) {
UI.Element._markDirty(this._slot, UIBaseButton._DIRTY_BTN_FOCUSED_COLOR);
}
return this;
}
public get focusedAlpha(): number | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackAlpha(UIBaseButton._focusedRgba[btnSlot]);
}
public set focusedAlpha(alpha: number) {
this.setFocusedAlpha(alpha);
}
public setFocusedAlpha(alpha: number): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
if (UIBaseButton._setAlpha(UIBaseButton._focusedRgba, btnSlot, alpha)) {
UI.Element._markDirty(this._slot, UIBaseButton._DIRTY_BTN_FOCUSED_ALPHA);
}
return this;
}
}
export namespace UIBaseButton {
export enum Event {
ClickUp = 0,
ClickDown = 1,
FocusIn = 2,
FocusOut = 3,
}
export type Handlers = {
onClickUp?: UI.ButtonHandler;
onClickDown?: UI.ButtonHandler;
onFocusIn?: UI.ButtonHandler;
onFocusOut?: UI.ButtonHandler;
};
export type Styling = {
enabled?: boolean;
baseColor?: Colors.Color;
baseAlpha?: number;
disabledColor?: Colors.Color;
disabledAlpha?: number;
pressedColor?: Colors.Color;
pressedAlpha?: number;
focusedColor?: Colors.Color;
focusedAlpha?: number;
};
export type Params = UI.ElementParams & Styling & Handlers;
}
// --- SOURCE: node_modules\bf6-portal-utils\ui\components\content-button\index.ts ---
export abstract class UIContentButton<TContent extends UI.Element> extends UIBaseButton {
protected static readonly _DIRTY_BTN_SIZE = 1 << UIBaseButton._UNUSED_DIRTY_OFFSET;
protected static override readonly _UNUSED_DIRTY_OFFSET = UIBaseButton._UNUSED_DIRTY_OFFSET + 1;
private static readonly _ScratchParent = class extends UI.Node implements UI.Parent {
public constructor() {
super(UI.Node._INVALID_INDEX);
}
public override get isValid(): boolean {
return true;
}
public set(id: number): void {
this._id = id;
}
public get parent(): null {
return null;
}
public get children(): readonly UI.Element[] {
return [];
}
public getChild(): null {
return null;
}
public get childCount(): number {
return 0;
}
public forEachChild(): void {}
};
private static readonly _scratchParent = new UIContentButton._ScratchParent();
private static readonly _scratchContentSize: UI.Size = { width: 0, height: 0 };
protected static readonly _padding = new Float32Array(UIBaseButton.MAX_BUTTONS);
protected static readonly _buttonWidgets = new Array<mod.UIWidget | null>(UIBaseButton.MAX_BUTTONS);
protected static readonly _contents = new Array<UI.Element | null>(UIBaseButton.MAX_BUTTONS);
protected static readonly _contentRgba = new Uint32Array(UIBaseButton.MAX_BUTTONS);
protected static readonly _contentDisabledRgba = new Uint32Array(UIBaseButton.MAX_BUTTONS);
protected constructor(
params: UIContentButton.Params,
createContent: (parent: UI.Parent, width: number, height: number) => TContent
) {
super(params);
if (!this._isValid) return;
const parent = params.parent ?? UI.ROOT_NODE;
const receiver = this._receiver!;
const name = this._name;
const { x, y } = UI.Element._getPosition(params);
const { width, height } = UI.Element._getSize(params);
const depth = params.depth ?? UI.Depth.AboveGameUI;
const padding = params.padding ?? 0;
const anchor = params.anchor ?? UI.Anchor.Center;
const visible = params.visible ?? true;
const nativeAnchor = UI.Element._getNativeAnchor(anchor);
const nativeDepth = UI.Element._getNativeDepth(depth);
const nativeBgFillNone = UI.Element._getNativeBgFill(UI.BgFill.None);
const nativeCenterAnchor = UI.Element._getNativeAnchor(UI.Anchor.Center);
if (!receiver.nativeReceiver) {
mod.AddUIContainer(
name,
mod.CreateVector(x, y, 0),
mod.CreateVector(width, height, 0),
nativeAnchor,
UI.Element._getNativeWidget(parent)!,
visible,
padding,
Colors.toVector(UI.COLORS.WHITE),
0,
nativeBgFillNone,
nativeDepth
);
} else {
mod.AddUIContainer(
name,
mod.CreateVector(x, y, 0),
mod.CreateVector(width, height, 0),
nativeAnchor,
UI.Element._getNativeWidget(parent)!,
visible,
padding,
Colors.toVector(UI.COLORS.WHITE),
0,
nativeBgFillNone,
nativeDepth,
receiver.nativeReceiver
);
}
this._bindNativeWidget(name);
const buttonName = `${name}_b`;
const enabled = params.enabled ?? true;
const bgColor = params.bgColor ?? UI.COLORS.WHITE;
const bgAlpha = params.bgAlpha ?? 1;
const bgFill = params.bgFill ?? UI.BgFill.Solid;
const baseColor = params.baseColor ?? UI.COLORS.BF_GREY_2;
const baseAlpha = params.baseAlpha ?? 1;
const disabledColor = params.disabledColor ?? UI.COLORS.BF_GREY_3;
const disabledAlpha = params.disabledAlpha ?? 1;
const pressedColor = params.pressedColor ?? UI.COLORS.BF_GREEN_BRIGHT;
const pressedAlpha = params.pressedAlpha ?? 1;
const focusedColor = params.focusedColor ?? UI.COLORS.BF_GREY_1;
const focusedAlpha = params.focusedAlpha ?? 1;
const nativeBtnBgFill = UI.Element._getNativeBgFill(bgFill);
if (!receiver.nativeReceiver) {
mod.AddUIButton(
buttonName,
UI.ZERO_VECTOR,
mod.CreateVector(width, height, 0),
nativeCenterAnchor,
this._uiWidget,
true,
0,
Colors.toVector(bgColor),
bgAlpha,
nativeBtnBgFill,
enabled,
Colors.toVector(baseColor),
baseAlpha,
Colors.toVector(disabledColor),
disabledAlpha,
Colors.toVector(pressedColor),
pressedAlpha,
Colors.toVector(focusedColor),
focusedAlpha,
Colors.toVector(focusedColor),
focusedAlpha,
nativeDepth
);
} else {
mod.AddUIButton(
buttonName,
UI.ZERO_VECTOR,
mod.CreateVector(width, height, 0),
nativeCenterAnchor,
this._uiWidget,
true,
0,
Colors.toVector(bgColor),
bgAlpha,
nativeBtnBgFill,
enabled,
Colors.toVector(baseColor),
baseAlpha,
Colors.toVector(disabledColor),
disabledAlpha,
Colors.toVector(pressedColor),
pressedAlpha,
Colors.toVector(focusedColor),
focusedAlpha,
Colors.toVector(focusedColor),
focusedAlpha,
nativeDepth,
receiver.nativeReceiver
);
}
const buttonWidget = mod.FindUIWidgetWithName(buttonName) as mod.UIWidget;
const slot = this._slot;
const btnSlot = this._buttonSlot;
UIContentButton._padding[btnSlot] = padding;
UIContentButton._buttonWidgets[btnSlot] = buttonWidget;
UI.Element._setBgAlpha(slot, bgAlpha);
UI.Element._setBgFill(slot, bgFill);
UI.Element._setEnabled(slot, enabled);
UI.Element._setForegroundAlpha(slot, baseAlpha);
UI.Element._setForegroundColor(slot, baseColor);
UIBaseButton._setAlpha(UIBaseButton._disabledRgba, btnSlot, disabledAlpha);
UIBaseButton._setRgb(UIBaseButton._disabledRgba, btnSlot, disabledColor);
UIBaseButton._setAlpha(UIBaseButton._pressedRgba, btnSlot, pressedAlpha);
UIBaseButton._setRgb(UIBaseButton._pressedRgba, btnSlot, pressedColor);
UIBaseButton._setAlpha(UIBaseButton._focusedRgba, btnSlot, focusedAlpha);
UIBaseButton._setRgb(UIBaseButton._focusedRgba, btnSlot, focusedColor);
this._setupButtonHandlers(params);
const widthNetOfPadding = Math.max(0, width - padding * 2);
const heightNetOfPadding = Math.max(0, height - padding * 2);
const scratchParent = UIContentButton._scratchParent;
scratchParent.set(this._id);
UIContentButton._contents[btnSlot] = createContent(scratchParent, widthNetOfPadding, heightNetOfPadding);
scratchParent.set(UI.Node._INVALID_INDEX);
}
protected override _handleFlush(flags: number, widget: mod.UIWidget): void {
super._handleFlush(flags, widget);
const slot = this._slot;
const btnSlot = UIBaseButton._elementToButtonSlot[slot];
if (btnSlot === UIBaseButton._INVALID_INDEX) return;
const btnWidget = UIContentButton._buttonWidgets[btnSlot];
if (!btnWidget) return;
if (flags & UIContentButton._DIRTY_BTN_SIZE) {
const w = UI.Element._getWidth(slot);
const h = UI.Element._getHeight(slot);
mod.SetUIWidgetSize(btnWidget, mod.CreateVector(w, h, 0));
}
if (flags & UI.Element._DIRTY_BG_COLOR) {
mod.SetUIWidgetBgColor(btnWidget, Colors.toVector(UI.Element._getBgColor(slot)));
}
if (flags & UI.Element._DIRTY_BG_ALPHA) {
mod.SetUIWidgetBgAlpha(btnWidget, UI.Element._getBgAlpha(slot));
}
if (flags & UI.Element._DIRTY_BG_FILL) {
mod.SetUIWidgetBgFill(btnWidget, UI.Element._getNativeBgFill(UI.Element._getBgFill(slot)));
}
}
protected override get _buttonUIWidget(): mod.UIWidget | null {
const btnSlot = this._buttonSlot;
return btnSlot !== UIBaseButton._INVALID_INDEX ? UIContentButton._buttonWidgets[btnSlot] : null;
}
public override delete(): void {
const btnSlot = this._buttonSlot;
if (btnSlot !== UIBaseButton._INVALID_INDEX) {
UIContentButton._contents[btnSlot]?.delete();
const buttonWidget = UIContentButton._buttonWidgets[btnSlot];
if (buttonWidget) {
mod.DeleteUIWidget(buttonWidget);
}
UIContentButton._contents[btnSlot] = null;
UIContentButton._buttonWidgets[btnSlot] = null;
UIContentButton._padding[btnSlot] = 0;
UIContentButton._contentRgba[btnSlot] = 0;
UIContentButton._contentDisabledRgba[btnSlot] = 0;
}
super.delete();
}
public get content(): TContent | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX ? undefined : (UIContentButton._contents[btnSlot] as TContent);
}
public override get width(): number | undefined {
return super.width;
}
public override set width(width: number) {
this.setWidth(width);
}
public override setWidth(width: number): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
const slot = this._slot;
const oldWidth = this.width;
super.setWidth(width);
if (oldWidth === width) return this;
UI.Element._markDirty(slot, UIContentButton._DIRTY_BTN_SIZE);
const content = UIContentButton._contents[btnSlot];
if (content) {
content.width = Math.max(0, width - UIContentButton._padding[btnSlot] * 2);
}
return this;
}
public override get height(): number | undefined {
return super.height;
}
public override set height(height: number) {
this.setHeight(height);
}
public override setHeight(height: number): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
const slot = this._slot;
const oldHeight = this.height;
super.setHeight(height);
if (oldHeight === height) return this;
UI.Element._markDirty(slot, UIContentButton._DIRTY_BTN_SIZE);
const content = UIContentButton._contents[btnSlot];
if (content) {
content.height = Math.max(0, height - UIContentButton._padding[btnSlot] * 2);
}
return this;
}
public override get size(): UI.Size | undefined {
return super.size;
}
public override set size(params: UI.Size) {
this.setSize(params);
}
public override setSize(params: UI.Size): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
const slot = this._slot;
const oldWidth = this.width;
const oldHeight = this.height;
super.setSize(params);
if (oldWidth === params.width && oldHeight === params.height) return this;
UI.Element._markDirty(slot, UIContentButton._DIRTY_BTN_SIZE);
const content = UIContentButton._contents[btnSlot];
if (!content) return this;
const size = UIContentButton._scratchContentSize;
size.width = Math.max(0, params.width - UIContentButton._padding[btnSlot] * 2);
size.height = Math.max(0, params.height - UIContentButton._padding[btnSlot] * 2);
content.setSize(UIContentButton._scratchContentSize);
return this;
}
public get padding(): number | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX ? undefined : UIContentButton._padding[btnSlot];
}
public set padding(padding: number) {
this.setPadding(padding);
}
public setPadding(padding: number): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
if (UIContentButton._padding[btnSlot] === padding) return this;
UIContentButton._padding[btnSlot] = padding;
const slot = this._slot;
UI.Element._setPadding(slot, padding);
UI.Element._markDirty(slot, UI.Element._DIRTY_PADDING);
const content = UIContentButton._contents[btnSlot];
if (!content) return this;
const size = UIContentButton._scratchContentSize;
size.width = Math.max(0, (this.width ?? 0) - padding * 2);
size.height = Math.max(0, (this.height ?? 0) - padding * 2);
content.setSize(size);
return this;
}
}
export namespace UIContentButton {
export type Params = UIBaseButton.Params & {
padding?: number;
};
}
// --- SOURCE: node_modules\bf6-portal-utils\ui\components\text-button\index.ts ---
export class UITextButton extends UIContentButton<UIText> {
private static readonly _scratchTextParams: UIText.Params = {
label: null as unknown as mod.Message,
};
public constructor(params: UITextButton.Params) {
const createContent = (parent: UI.Parent, width: number, height: number): UIText => {
const scratch = UITextButton._scratchTextParams;
scratch.parent = parent;
scratch.width = width;
scratch.height = height;
scratch.label = params.label;
scratch.textSize = params.textSize;
scratch.textColor = params.textColor;
scratch.textAlpha = params.textAlpha;
scratch.textAnchor = params.textAnchor;
scratch.depth = params.depth;
const text = new UIText(scratch);
scratch.parent = undefined;
scratch.label = null as unknown as mod.Message;
scratch.textColor = undefined;
return text;
};
super(params, createContent);
if (!this._isValid) return;
const btnSlot = this._buttonSlot;
const textColor = params.textColor ?? UI.COLORS.BLACK;
const textAlpha = params.textAlpha ?? 1;
const textDisabledColor = params.textDisabledColor ?? UI.COLORS.BF_GREY_2;
const textDisabledAlpha = params.textDisabledAlpha ?? 1;
UIBaseButton._setAlpha(UIContentButton._contentRgba, btnSlot, textAlpha);
UIBaseButton._setRgb(UIContentButton._contentRgba, btnSlot, textColor);
UIBaseButton._setAlpha(UIContentButton._contentDisabledRgba, btnSlot, textDisabledAlpha);
UIBaseButton._setRgb(UIContentButton._contentDisabledRgba, btnSlot, textDisabledColor);
if (!this.enabled) {
this._setContentEnabled(false);
}
}
protected override _setContentEnabled(enabled: boolean): void {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return;
const content = this.content;
const contentWidget = content ? UI.Element._getNativeWidget(content) : null;
if (!content || !contentWidget) return;
const rgba = enabled ? UIContentButton._contentRgba[btnSlot] : UIContentButton._contentDisabledRgba[btnSlot];
const color = UIBaseButton._unpackColor(rgba);
const alpha = UIBaseButton._unpackAlpha(rgba);
content.setTextColor(color);
content.setTextAlpha(alpha);
}
public get label(): mod.Message | undefined {
return this._isValid ? this.content?.label : undefined;
}
public set label(label: mod.Message) {
this.setLabel(label);
}
public setLabel(label: mod.Message): this {
if (this._getIsInvalidAndLogWarning()) return this;
this.content?.setLabel(label);
return this;
}
public get textSize(): number | undefined {
return this._isValid ? this.content?.textSize : undefined;
}
public set textSize(size: number) {
this.setTextSize(size);
}
public setTextSize(size: number): this {
if (this._getIsInvalidAndLogWarning()) return this;
this.content?.setTextSize(size);
return this;
}
public get textAnchor(): UI.Anchor | undefined {
return this._isValid ? this.content?.textAnchor : undefined;
}
public set textAnchor(anchor: UI.Anchor) {
this.setTextAnchor(anchor);
}
public setTextAnchor(anchor: UI.Anchor): this {
if (this._getIsInvalidAndLogWarning()) return this;
this.content?.setTextAnchor(anchor);
return this;
}
public get textColor(): Colors.Color | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackColor(UIContentButton._contentRgba[btnSlot]);
}
public getTextColor(out?: Colors.Color): Colors.Color | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackColor(UIContentButton._contentRgba[btnSlot], out);
}
public set textColor(color: Colors.Color) {
this.setTextColor(color);
}
public setTextColor(color: Colors.Color): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
UIBaseButton._setRgb(UIContentButton._contentRgba, btnSlot, color);
if (this.enabled) {
this.content?.setTextColor(color);
}
return this;
}
public get textAlpha(): number | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackAlpha(UIContentButton._contentRgba[btnSlot]);
}
public set textAlpha(alpha: number) {
this.setTextAlpha(alpha);
}
public setTextAlpha(alpha: number): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
UIBaseButton._setAlpha(UIContentButton._contentRgba, btnSlot, alpha);
if (this.enabled) {
this.content?.setTextAlpha(alpha);
}
return this;
}
public get textDisabledColor(): Colors.Color | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackColor(UIContentButton._contentDisabledRgba[btnSlot]);
}
public getTextDisabledColor(out?: Colors.Color): Colors.Color | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackColor(UIContentButton._contentDisabledRgba[btnSlot], out);
}
public set textDisabledColor(color: Colors.Color) {
this.setTextDisabledColor(color);
}
public setTextDisabledColor(color: Colors.Color): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
UIBaseButton._setRgb(UIContentButton._contentDisabledRgba, btnSlot, color);
if (!this.enabled) {
this.content?.setTextColor(color);
}
return this;
}
public get textDisabledAlpha(): number | undefined {
const btnSlot = this._buttonSlot;
return btnSlot === UIBaseButton._INVALID_INDEX
? undefined
: UIBaseButton._unpackAlpha(UIContentButton._contentDisabledRgba[btnSlot]);
}
public set textDisabledAlpha(alpha: number) {
this.setTextDisabledAlpha(alpha);
}
public setTextDisabledAlpha(alpha: number): this {
const btnSlot = this._resolveButtonSlotAndLogWarning();
if (btnSlot === UIBaseButton._INVALID_INDEX) return this;
UIBaseButton._setAlpha(UIContentButton._contentDisabledRgba, btnSlot, alpha);
if (!this.enabled) {
this.content?.setTextAlpha(alpha);
}
return this;
}
}
export namespace UITextButton {
export type Params = UIBaseButton.Params &
UIText.Params & {
textDisabledColor?: Colors.Color;
textDisabledAlpha?: number;
};
}
// --- SOURCE: node_modules\bf6-portal-utils\ui\components\qr-code\encoder.ts ---
export class QREncoder {
public static readonly MAX_QR_VERSION = 40;
public static readonly DEFAULT_MARGIN = 4;
public static readonly MIN_QUIET_ZONE = 4;
private static readonly GF_EXP = new Uint8Array(512);
private static readonly GF_LOG = new Uint8Array(256);
private static readonly GENERATOR_POLYS: Uint8Array[] = new Array<Uint8Array>(31);
static {
let x = 1;
for (let i = 0; i < 255; ++i) {
QREncoder.GF_EXP[i] = x;
QREncoder.GF_EXP[i + 255] = x;
QREncoder.GF_LOG[x] = i;
x <<= 1;
if (x & 0x100) {
x ^= 0x11d;
}
}
let currentGen: Uint8Array = new Uint8Array([1]);
for (let i = 0; i < 30; ++i) {
currentGen = QREncoder.polyMul(currentGen, new Uint8Array([1, QREncoder.GF_EXP[i]]));
QREncoder.GENERATOR_POLYS[i + 1] = currentGen;
}
}
private static gfMul(a: number, b: number): number {
return a === 0 || b === 0 ? 0 : QREncoder.GF_EXP[QREncoder.GF_LOG[a] + QREncoder.GF_LOG[b]];
}
private static polyMul(p1: Uint8Array, p2: Uint8Array): Uint8Array {
const result = new Uint8Array(p1.length + p2.length - 1);
for (let i = 0; i < p1.length; ++i) {
for (let j = 0; j < p2.length; ++j) {
result[i + j] ^= QREncoder.gfMul(p1[i], p2[j]);
}
}
return result;
}
private static readonly _rsMsgBuffer = new Uint8Array(256);
private static readonly _utf8Buffer = new Uint8Array(2953);
private static readonly _dataCodewordsBuffer = new Uint8Array(3706);
private static readonly _interleavedBuffer = new Uint8Array(3706);
private static readonly _eccBytesBuffer = new Uint8Array(3706);
private static readonly _blockOffsets = new Uint16Array(128);
private static readonly _blockLens = new Uint16Array(128);
private static readonly _eccBlockOffsets = new Uint16Array(128);
private static readonly _versionResult: QREncoder.VersionInfo = { version: 0, totalDataCodewords: 0 };
private static readonly ECC_TABLE: ReadonlyArray<ReadonlyArray<[number, number, number, number, number]>> =
Object.freeze([
[
[7, 1, 19, 0, 0],
[10, 1, 16, 0, 0],
[13, 1, 13, 0, 0],
[17, 1, 9, 0, 0],
],
[
[10, 1, 34, 0, 0],
[16, 1, 28, 0, 0],
[22, 1, 22, 0, 0],
[28, 1, 16, 0, 0],
],
[
[15, 1, 55, 0, 0],
[26, 1, 44, 0, 0],
[18, 2, 17, 0, 0],
[22, 2, 13, 0, 0],
],
[
[20, 1, 80, 0, 0],
[18, 2, 32, 0, 0],
[26, 2, 24, 0, 0],
[16, 4, 9, 0, 0],
],
[
[26, 1, 108, 0, 0],
[24, 2, 43, 0, 0],
[18, 2, 15, 2, 16],
[22, 2, 11, 2, 12],
],
[
[18, 2, 68, 0, 0],
[16, 4, 27, 0, 0],
[24, 4, 19, 0, 0],
[28, 4, 15, 0, 0],
],
[
[20, 2, 78, 0, 0],
[18, 4, 31, 0, 0],
[18, 2, 14, 4, 15],
[26, 4, 13, 1, 14],
],
[
[24, 2, 97, 0, 0],
[22, 2, 38, 2, 39],
[22, 4, 18, 2, 19],
[26, 4, 14, 2, 15],
],
[
[30, 2, 116, 0, 0],
[22, 3, 36, 2, 37],
[20, 4, 16, 4, 17],
[24, 4, 12, 4, 13],
],
[
[18, 2, 68, 2, 69],
[26, 4, 43, 1, 44],
[24, 6, 19, 2, 20],
[28, 6, 15, 2, 16],
],
[
[20, 4, 81, 0, 0],
[30, 1, 50, 4, 51],
[28, 4, 22, 4, 23],
[24, 3, 12, 8, 13],
],
[
[24, 2, 92, 2, 93],
[22, 6, 36, 2, 37],
[26, 4, 20, 6, 21],
[28, 7, 14, 4, 15],
],
[
[26, 4, 107, 0, 0],
[22, 8, 37, 1, 38],
[24, 8, 20, 4, 21],
[22, 12, 11, 4, 12],
],
[
[30, 3, 115, 1, 116],
[24, 4, 40, 5, 41],
[20, 11, 16, 5, 17],
[24, 11, 12, 5, 13],
],
[
[22, 5, 87, 1, 88],
[24, 5, 41, 5, 42],
[30, 5, 24, 7, 25],
[24, 11, 12, 7, 13],
],
[
[24, 5, 98, 1, 99],
[28, 7, 45, 3, 46],
[24, 15, 19, 2, 20],
[30, 3, 15, 13, 16],
],
[
[28, 1, 107, 5, 108],
[28, 10, 46, 1, 47],
[28, 1, 22, 15, 23],
[28, 2, 14, 17, 15],
],
[
[30, 5, 120, 1, 121],
[26, 9, 43, 4, 44],
[28, 17, 22, 1, 23],
[28, 2, 14, 19, 15],
],
[
[28, 3, 113, 4, 114],
[26, 3, 44, 11, 45],
[26, 17, 21, 4, 22],
[26, 9, 13, 16, 14],
],
[
[28, 3, 107, 5, 108],
[26, 3, 41, 13, 42],
[30, 15, 24, 5, 25],
[28, 15, 15, 10, 16],
],
[
[28, 4, 116, 4, 117],
[26, 17, 42, 0, 0],
[28, 17, 22, 6, 23],
[30, 19, 16, 6, 17],
],
[
[28, 2, 111, 7, 112],
[28, 17, 46, 0, 0],
[30, 7, 24, 16, 25],
[24, 34, 13, 0, 0],
],
[
[30, 4, 121, 5, 122],
[28, 4, 47, 14, 48],
[30, 11, 24, 14, 25],
[30, 16, 15, 14, 16],
],
[
[30, 6, 117, 4, 118],
[28, 6, 45, 14, 46],
[30, 11, 24, 16, 25],
[30, 30, 16, 2, 17],
],
[
[26, 8, 106, 4, 107],
[28, 8, 47, 13, 48],
[30, 7, 24, 22, 25],
[30, 22, 15, 13, 16],
],
[
[28, 10, 114, 2, 115],
[28, 19, 46, 4, 47],
[28, 28, 22, 6, 23],
[30, 33, 16, 4, 17],
],
[
[30, 8, 122, 4, 123],
[28, 22, 45, 3, 46],
[30, 8, 23, 26, 24],
[30, 12, 15, 28, 16],
],
[
[30, 3, 117, 10, 118],
[28, 3, 45, 23, 46],
[30, 4, 24, 31, 25],
[30, 11, 15, 31, 16],
],
[
[30, 7, 116, 7, 117],
[28, 21, 45, 7, 46],
[30, 1, 23, 37, 24],
[30, 19, 15, 26, 16],
],
[
[30, 5, 115, 10, 116],
[28, 19, 47, 10, 48],
[30, 15, 24, 25, 25],
[30, 23, 15, 25, 16],
],
[
[30, 13, 115, 3, 116],
[28, 2, 46, 29, 47],
[30, 42, 24, 1, 25],
[30, 23, 15, 28, 16],
],
[
[30, 17, 115, 0, 0],
[28, 10, 46, 23, 47],
[30, 10, 24, 35, 25],
[30, 19, 15, 35, 16],
],
[
[30, 17, 115, 1, 116],
[28, 14, 46, 21, 47],
[30, 29, 24, 19, 25],
[30, 11, 15, 46, 16],
],
[
[30, 13, 115, 6, 116],
[28, 14, 46, 23, 47],
[30, 44, 24, 7, 25],
[30, 59, 16, 1, 17],
],
[
[30, 12, 121, 7, 122],
[28, 12, 47, 26, 48],
[30, 39, 24, 14, 25],
[30, 22, 15, 41, 16],
],
[
[30, 6, 121, 14, 122],
[28, 6, 47, 34, 48],
[30, 46, 24, 10, 25],
[30, 2, 15, 64, 16],
],
[
[30, 17, 122, 4, 123],
[28, 29, 46, 14, 47],
[30, 49, 24, 10, 25],
[30, 24, 15, 46, 16],
],
[
[30, 4, 122, 18, 123],
[28, 13, 46, 32, 47],
[30, 48, 24, 14, 25],
[30, 42, 15, 32, 16],
],
[
[30, 20, 117, 4, 118],
[28, 40, 47, 7, 48],
[30, 43, 24, 22, 25],
[30, 10, 15, 67, 16],
],
[
[30, 19, 118, 6, 119],
[28, 18, 47, 31, 48],
[30, 34, 24, 34, 25],
[30, 20, 15, 61, 16],
],
]);
private static readonly FORMAT_COORDS_TOP_LEFT: ReadonlyArray<readonly [number, number]> = Object.freeze([
[0, 8],
[1, 8],
[2, 8],
[3, 8],
[4, 8],
[5, 8],
[7, 8],
[8, 8],
[8, 7],
[8, 5],
[8, 4],
[8, 3],
[8, 2],
[8, 1],
[8, 0],
]);
private static computeReedSolomon(
data: Uint8Array,
dataOffset: number,
dataLen: number,
eccLen: number,
outEcc: Uint8Array,
outEccOffset: number
): void {
const gen = QREncoder.GENERATOR_POLYS[eccLen];
const totalLen = dataLen + eccLen;
for (let i = 0; i < dataLen; ++i) {
QREncoder._rsMsgBuffer[i] = data[dataOffset + i];
}
for (let i = dataLen; i < totalLen; ++i) {
QREncoder._rsMsgBuffer[i] = 0;
}
for (let i = 0; i < dataLen; ++i) {
const coef = QREncoder._rsMsgBuffer[i];
if (coef === 0) continue;
for (let j = 0; j < gen.length; ++j) {
QREncoder._rsMsgBuffer[i + j] ^= QREncoder.gfMul(gen[j], coef);
}
}
for (let i = 0; i < eccLen; ++i) {
outEcc[outEccOffset + i] = QREncoder._rsMsgBuffer[dataLen + i];
}
}
private static encodeUtf8(str: string): number {
let outIdx = 0;
const max = QREncoder._utf8Buffer.length;
for (let i = 0; i < str.length; ++i) {
const code = str.charCodeAt(i);
if (code < 0x80) {
if (outIdx >= max) return -1;
QREncoder._utf8Buffer[outIdx++] = code;
} else if (code < 0x800) {
if (outIdx + 1 >= max) return -1;
QREncoder._utf8Buffer[outIdx++] = 0xc0 | (code >> 6);
QREncoder._utf8Buffer[outIdx++] = 0x80 | (code & 0x3f);
} else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
if (outIdx + 3 >= max) return -1;
const next = str.charCodeAt(++i);
const codePoint = 0x10000 + ((code & 0x3ff) << 10) + (next & 0x3ff);
QREncoder._utf8Buffer[outIdx++] = 0xf0 | (codePoint >> 18);
QREncoder._utf8Buffer[outIdx++] = 0x80 | ((codePoint >> 12) & 0x3f);
QREncoder._utf8Buffer[outIdx++] = 0x80 | ((codePoint >> 6) & 0x3f);
QREncoder._utf8Buffer[outIdx++] = 0x80 | (codePoint & 0x3f);
} else {
if (outIdx + 2 >= max) return -1;
QREncoder._utf8Buffer[outIdx++] = 0xe0 | (code >> 12);
QREncoder._utf8Buffer[outIdx++] = 0x80 | ((code >> 6) & 0x3f);
QREncoder._utf8Buffer[outIdx++] = 0x80 | (code & 0x3f);
}
}
return outIdx;
}
public static getEccIndex(ecc: QREncoder.ECC | string | number): number {
if (typeof ecc === 'number') return ecc >= 0 && ecc <= 3 ? ecc : 1;
if (typeof ecc === 'string') {
const norm = ecc.toUpperCase();
if (norm === 'L' || norm === 'LOW') return 0;
if (norm === 'M' || norm === 'MEDIUM') return 1;
if (norm === 'Q' || norm === 'QUARTILE') return 2;
if (norm === 'H' || norm === 'HIGH') return 3;
}
return 1;
}
public static getDataByteLength(data: QREncoder.Payload): number {
if (typeof data === 'string') {
let len = 0;
for (let i = 0; i < data.length; ++i) {
const code = data.charCodeAt(i);
if (code < 0x80) {
len++;
} else if (code < 0x800) {
len += 2;
} else if (code >= 0xd800 && code <= 0xdbff && i + 1 < data.length) {
i++;
len += 4;
} else {
len += 3;
}
}
return len;
}
if (data instanceof Uint8Array || Array.isArray(data)) return data.length;
if (ArrayBuffer.isView(data)) return data.byteLength;
return -1;
}
private static getVersionInfoBits(version: number): number {
let d = version << 12;
while (d >= 1 << 12) {
const shift = 31 - Math.clz32(d) - 12;
if (shift < 0) break;
d ^= 0x1f25 << shift;
}
return (version << 12) | d;
}
private static getFormatInfoBits(eccOrIdx: QREncoder.ECC | string | number, mask: number): number {
const eccIdx = QREncoder.getEccIndex(eccOrIdx);
const eccBits = [1, 0, 3, 2][eccIdx];
const data = (eccBits << 3) | mask;
let d = data << 10;
while (d >= 1 << 10) {
const shift = 31 - Math.clz32(d) - 10;
if (shift < 0) break;
d ^= 0x537 << shift;
}
return ((data << 10) | d) ^ 0x5412;
}
private static getSecondFormatCoord(index: number, size: number): [number, number] {
return index < 7 ? [size - 1 - index, 8] : [8, size - 15 + index];
}
public static selectVersion(
dataByteLen: number,
eccIdx: number | QREncoder.ECC | string,
maxVersion: number = QREncoder.MAX_QR_VERSION,
logger?: QREncoder.LoggerLike
): QREncoder.VersionInfo | null {
const idx = typeof eccIdx === 'number' ? eccIdx : QREncoder.getEccIndex(eccIdx);
const limit = Math.min(40, Math.max(1, maxVersion));
for (let v = 1; v <= limit; ++v) {
const eccConfig = QREncoder.ECC_TABLE[v - 1][idx];
const dataCapacity = eccConfig[1] * eccConfig[2] + eccConfig[3] * eccConfig[4];
const charCountBits = v < 10 ? 8 : 16;
const totalBits = 4 + charCountBits + dataByteLen * 8;
const totalBytes = Math.ceil(totalBits / 8);
if (totalBytes > dataCapacity) continue;
QREncoder._versionResult.version = v;
QREncoder._versionResult.totalDataCodewords = dataCapacity;
return QREncoder._versionResult;
}
if (logger) {
logger.log(`Data payload too large for QR code (bytes: ${dataByteLen})`);
}
return null;
}
private static buildDataBytes(dataLen: number, version: number, totalDataCodewords: number): void {
const charCountBits = version < 10 ? 8 : 16;
let bitCount = 0;
QREncoder._dataCodewordsBuffer.fill(0, 0, totalDataCodewords);
function pushBits(val: number, len: number): void {
for (let i = len - 1; i >= 0; --i) {
const bit = (val >> i) & 1;
const byteIndex = bitCount >> 3;
const bitPos = 7 - (bitCount & 7);
if (bitPos === 7) {
QREncoder._dataCodewordsBuffer[byteIndex] = bit << 7;
} else {
QREncoder._dataCodewordsBuffer[byteIndex] |= bit << bitPos;
}
bitCount++;
}
}
pushBits(0b0100, 4);
pushBits(dataLen, charCountBits);
for (let i = 0; i < dataLen; ++i) {
pushBits(QREncoder._utf8Buffer[i], 8);
}
const capacityBits = totalDataCodewords * 8;
const termLen = Math.min(4, capacityBits - bitCount);
pushBits(0, termLen);
while (bitCount % 8 !== 0) {
pushBits(0, 1);
}
const padBytes = [0xec, 0x11];
let padIdx = 0;
while (bitCount < capacityBits) {
pushBits(padBytes[padIdx], 8);
padIdx ^= 1;
}
}
private static interleaveBlocks(version: number, eccIdx: number): number {
const eccConfig = QREncoder.ECC_TABLE[version - 1][eccIdx];
const eccPerBlock = eccConfig[0];
const numBlocksG1 = eccConfig[1];
const dataPerBlockG1 = eccConfig[2];
const numBlocksG2 = eccConfig[3];
const dataPerBlockG2 = eccConfig[4];
const totalBlocks = numBlocksG1 + numBlocksG2;
let dataOffset = 0;
let eccOffset = 0;
function processBlockGroup(startBlockIdx: number, numBlocks: number, dataPerBlock: number): void {
for (let b = 0; b < numBlocks; ++b) {
const blockIdx = startBlockIdx + b;
QREncoder._blockOffsets[blockIdx] = dataOffset;
QREncoder._blockLens[blockIdx] = dataPerBlock;
QREncoder._eccBlockOffsets[blockIdx] = eccOffset;
QREncoder.computeReedSolomon(
QREncoder._dataCodewordsBuffer,
dataOffset,
dataPerBlock,
eccPerBlock,
QREncoder._eccBytesBuffer,
eccOffset
);
dataOffset += dataPerBlock;
eccOffset += eccPerBlock;
}
}
processBlockGroup(0, numBlocksG1, dataPerBlockG1);
processBlockGroup(numBlocksG1, numBlocksG2, dataPerBlockG2);
let outIdx = 0;
const maxDataBlockLen = Math.max(dataPerBlockG1, dataPerBlockG2);
for (let i = 0; i < maxDataBlockLen; ++i) {
for (let b = 0; b < totalBlocks; ++b) {
if (i < QREncoder._blockLens[b]) {
QREncoder._interleavedBuffer[outIdx++] =
QREncoder._dataCodewordsBuffer[QREncoder._blockOffsets[b] + i];
}
}
}
for (let i = 0; i < eccPerBlock; ++i) {
for (let b = 0; b < totalBlocks; ++b) {
QREncoder._interleavedBuffer[outIdx++] = QREncoder._eccBytesBuffer[QREncoder._eccBlockOffsets[b] + i];
}
}
return outIdx;
}
private static drawFinder(size: number, r: number, c: number, scratch: Uint8Array): void {
for (let i = -1; i <= 7; ++i) {
for (let j = -1; j <= 7; ++j) {
const nr = r + i;
const nc = c + j;
if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
if (i >= 0 && i <= 6 && j >= 0 && j <= 6) {
const isBlack = i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4);
scratch[nr * size + nc] = 1 | (isBlack ? 2 : 0);
} else {
scratch[nr * size + nc] = 1;
}
}
}
}
private static drawFinders(size: number, scratch: Uint8Array): void {
QREncoder.drawFinder(size, 0, 0, scratch);
QREncoder.drawFinder(size, 0, size - 7, scratch);
QREncoder.drawFinder(size, size - 7, 0, scratch);
}
private static drawAlignments(size: number, version: number, scratch: Uint8Array): void {
if (version < 2) return;
const positions = QREncoder.ALIGNMENT_POSITIONS[version - 1];
for (let p1 = 0; p1 < positions.length; ++p1) {
const r = positions[p1];
for (let p2 = 0; p2 < positions.length; ++p2) {
const c = positions[p2];
if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
for (let i = -2; i <= 2; ++i) {
for (let j = -2; j <= 2; ++j) {
const isBlack = Math.max(Math.abs(i), Math.abs(j)) === 2 || (i === 0 && j === 0);
scratch[(r + i) * size + (c + j)] = 1 | (isBlack ? 2 : 0);
}
}
}
}
}
private static drawTimingPatterns(size: number, scratch: Uint8Array): void {
for (let i = 8; i < size - 8; ++i) {
scratch[6 * size + i] = 1 | (i % 2 === 0 ? 2 : 0);
scratch[i * size + 6] = 1 | (i % 2 === 0 ? 2 : 0);
}
scratch[(size - 8) * size + 8] = 1 | 2;
}
private static reserveFormatAndVersionInfo(size: number, version: number, scratch: Uint8Array): void {
for (let i = 0; i <= 8; ++i) {
scratch[8 * size + i] |= 1;
scratch[i * size + 8] |= 1;
}
for (let i = 0; i < 8; ++i) {
scratch[8 * size + (size - 1 - i)] |= 1;
}
for (let i = 0; i < 7; ++i) {
scratch[(size - 1 - i) * size + 8] |= 1;
}
if (version < 7) return;
for (let i = 0; i < 6; ++i) {
for (let j = 0; j < 3; ++j) {
scratch[i * size + (size - 11 + j)] |= 1;
scratch[(size - 11 + j) * size + i] |= 1;
}
}
}
private static placeDataCodewords(size: number, totalCodewords: number, scratch: Uint8Array): void {
const totalDataBits = totalCodewords * 8;
let bitIdx = 0;
let right = size - 1;
let upward = true;
while (right > 0) {
if (right === 6) right--;
for (let vert = 0; vert < size; ++vert) {
const r = upward ? size - 1 - vert : vert;
for (let colOffset = 0; colOffset < 2; ++colOffset) {
const c = right - colOffset;
const offset = r * size + c;
if ((scratch[offset] & 1) !== 0) continue;
let bit = false;
if (bitIdx < totalDataBits) {
const byte = QREncoder._interleavedBuffer[bitIdx >> 3];
const bitPos = 7 - (bitIdx & 7);
bit = ((byte >> bitPos) & 1) === 1;
}
bitIdx++;
scratch[offset] = bit ? 2 : 0;
}
}
upward = !upward;
right -= 2;
}
}
private static isMaskCondition(m: number, r: number, c: number): boolean {
switch (m) {
case 0:
return (r + c) % 2 === 0;
case 1:
return r % 2 === 0;
case 2:
return c % 3 === 0;
case 3:
return (r + c) % 3 === 0;
case 4:
return ((r >> 1) + Math.floor(c / 3)) % 2 === 0;
case 5:
return ((r * c) % 2) + ((r * c) % 3) === 0;
case 6:
return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
case 7:
return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
default:
return false;
}
}
private static getCellBit(r: number, c: number, m: number, size: number, scratch: Uint8Array): boolean {
const val = scratch[r * size + c];
const isDark = (val & 2) !== 0;
const isFunc = (val & 1) !== 0;
return isFunc ? isDark : isDark !== QREncoder.isMaskCondition(m, r, c);
}
private static calculatePenalty(m: number, size: number, scratch: Uint8Array): number {
let penalty = 0;
for (let r = 0; r < size; ++r) {
let rowCount = 0;
let rowColor = false;
let colCount = 0;
let colColor = false;
for (let c = 0; c < size; ++c) {
const rColor = QREncoder.getCellBit(r, c, m, size, scratch);
if (c === 0 || rColor !== rowColor) {
rowColor = rColor;
rowCount = 1;
} else {
rowCount++;
if (rowCount === 5) {
penalty += 3;
} else if (rowCount > 5) {
penalty++;
}
}
const cColor = QREncoder.getCellBit(c, r, m, size, scratch);
if (c === 0 || cColor !== colColor) {
colColor = cColor;
colCount = 1;
} else {
colCount++;
if (colCount === 5) {
penalty += 3;
} else if (colCount > 5) {
penalty++;
}
}
}
}
for (let r = 0; r < size - 1; ++r) {
for (let c = 0; c < size - 1; ++c) {
const val = QREncoder.getCellBit(r, c, m, size, scratch);
if (
val === QREncoder.getCellBit(r, c + 1, m, size, scratch) &&
val === QREncoder.getCellBit(r + 1, c, m, size, scratch) &&
val === QREncoder.getCellBit(r + 1, c + 1, m, size, scratch)
) {
penalty += 3;
}
}
}
let darkCount = 0;
for (let r = 0; r < size; ++r) {
for (let c = 0; c < size; ++c) {
if (QREncoder.getCellBit(r, c, m, size, scratch)) {
darkCount++;
}
}
}
const ratio = (darkCount * 100) / (size * size);
const step = Math.floor(Math.abs(ratio - 50) / 5);
penalty += step * 10;
return penalty;
}
private static evaluateBestMask(size: number, eccIdx: number, scratch: Uint8Array): number {
let bestMask = 0;
let lowestPenalty = Infinity;
for (let m = 0; m < 8; ++m) {
const formatBits = QREncoder.getFormatInfoBits(eccIdx, m);
for (let i = 0; i < 15; ++i) {
const bit = ((formatBits >> i) & 1) === 1;
const [r1, c1] = QREncoder.FORMAT_COORDS_TOP_LEFT[i];
const [r2, c2] = QREncoder.getSecondFormatCoord(i, size);
scratch[r1 * size + c1] = 1 | (bit ? 2 : 0);
scratch[r2 * size + c2] = 1 | (bit ? 2 : 0);
}
const penalty = QREncoder.calculatePenalty(m, size, scratch);
if (penalty < lowestPenalty) {
lowestPenalty = penalty;
bestMask = m;
}
}
return bestMask;
}
private static applyMask(size: number, mask: number, scratch: Uint8Array): void {
for (let r = 0; r < size; ++r) {
const rowOffset = r * size;
for (let c = 0; c < size; ++c) {
const offset = rowOffset + c;
if ((scratch[offset] & 1) === 0 && QREncoder.isMaskCondition(mask, r, c)) {
scratch[offset] ^= 2;
}
}
}
}
private static writeFormatAndVersionInfo(
size: number,
eccIdx: number,
mask: number,
version: number,
scratch: Uint8Array
): void {
const formatBits = QREncoder.getFormatInfoBits(eccIdx, mask);
for (let i = 0; i < 15; ++i) {
const bit = ((formatBits >> i) & 1) === 1;
const [r1, c1] = QREncoder.FORMAT_COORDS_TOP_LEFT[i];
const [r2, c2] = QREncoder.getSecondFormatCoord(i, size);
scratch[r1 * size + c1] = 1 | (bit ? 2 : 0);
scratch[r2 * size + c2] = 1 | (bit ? 2 : 0);
}
if (version < 7) return;
const verBits = QREncoder.getVersionInfoBits(version);
for (let i = 0; i < 18; ++i) {
const bit = ((verBits >> i) & 1) === 1;
const a = Math.floor(i / 3);
const b = (i % 3) + size - 11;
scratch[a * size + b] = 1 | (bit ? 2 : 0);
scratch[b * size + a] = 1 | (bit ? 2 : 0);
}
}
public static encodeToBuffer(
data: QREncoder.Payload,
eccOrIdx: QREncoder.ECC | string | number,
scratchBuffer: Uint8Array,
maxVersion: number = QREncoder.MAX_QR_VERSION,
logger?: QREncoder.LoggerLike
): number {
if (scratchBuffer == null) return -1;
if (data == null) {
if (logger) {
logger.log('Cannot encode QR code: data is null or undefined');
}
return -1;
}
let dataLen = 0;
if (typeof data === 'string') {
dataLen = QREncoder.encodeUtf8(data);
if (dataLen < 0) {
if (logger) {
logger.log('Cannot encode QR code: UTF-8 payload exceeds buffer capacity');
}
return -1;
}
} else if (data instanceof Uint8Array) {
dataLen = data.length;
if (dataLen > QREncoder._utf8Buffer.length) return -1;
for (let i = 0; i < dataLen; ++i) {
QREncoder._utf8Buffer[i] = data[i];
}
} else if (ArrayBuffer.isView(data)) {
dataLen = data.byteLength;
if (dataLen > QREncoder._utf8Buffer.length) return -1;
const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
for (let i = 0; i < dataLen; ++i) {
QREncoder._utf8Buffer[i] = view[i];
}
} else if (Array.isArray(data)) {
dataLen = data.length;
if (dataLen > QREncoder._utf8Buffer.length) return -1;
for (let i = 0; i < dataLen; ++i) {
QREncoder._utf8Buffer[i] = data[i];
}
} else {
if (logger) {
logger.log('Cannot encode QR code: data must be a string, Uint8Array, or number array');
}
return -1;
}
const eccIdx = QREncoder.getEccIndex(eccOrIdx);
const versionInfo = QREncoder.selectVersion(dataLen, eccIdx, maxVersion, logger);
if (!versionInfo || versionInfo.version > maxVersion) return -1;
const { version, totalDataCodewords } = versionInfo;
const size = 17 + 4 * version;
if (scratchBuffer.length < size * size) return -1;
QREncoder.buildDataBytes(dataLen, version, totalDataCodewords);
const totalCodewords = QREncoder.interleaveBlocks(version, eccIdx);
scratchBuffer.fill(0, 0, size * size);
QREncoder.drawFinders(size, scratchBuffer);
QREncoder.drawAlignments(size, version, scratchBuffer);
QREncoder.drawTimingPatterns(size, scratchBuffer);
QREncoder.reserveFormatAndVersionInfo(size, version, scratchBuffer);
QREncoder.placeDataCodewords(size, totalCodewords, scratchBuffer);
const bestMask = QREncoder.evaluateBestMask(size, eccIdx, scratchBuffer);
QREncoder.applyMask(size, bestMask, scratchBuffer);
QREncoder.writeFormatAndVersionInfo(size, eccIdx, bestMask, version, scratchBuffer);
return size;
}
public static encode(
data: QREncoder.Payload,
ecc: QREncoder.ECC | string = QREncoder.ECC.Medium,
options?: QREncoder.EncodeOptions
): boolean[][] | null {
if (data == null) return null;
const eccIdx = QREncoder.getEccIndex(ecc);
const byteLen = QREncoder.getDataByteLength(data);
if (byteLen < 0) return null;
const maxVersion = options?.maxVersion ?? QREncoder.MAX_QR_VERSION;
const versionInfo = QREncoder.selectVersion(byteLen, eccIdx, maxVersion);
if (!versionInfo || versionInfo.version > maxVersion) return null;
const size = 17 + 4 * versionInfo.version;
const minBytes = size * size;
let scratch = options?.scratchBuffer;
if (!scratch || scratch.length < minBytes) {
scratch = new Uint8Array(minBytes);
}
const encodedSize = QREncoder.encodeToBuffer(data, eccIdx, scratch, maxVersion);
if (encodedSize !== size) return null;
const matrix: boolean[][] = new Array(size);
for (let r = 0; r < size; ++r) {
const row = new Array<boolean>(size);
const rowOffset = r * size;
for (let c = 0; c < size; ++c) {
row[c] = (scratch[rowOffset + c] & 2) !== 0;
}
matrix[r] = row;
}
return matrix;
}
public static encodeToAscii(data: QREncoder.Payload, options?: QREncoder.AsciiOptions): string | null {
const matrix = QREncoder.encode(data, options?.ecc ?? QREncoder.ECC.Medium, options);
if (!matrix) return null;
const margin = Math.max(4, options?.margin ?? 4);
const invert = options?.invert ?? false;
const N = matrix.length;
const totalSize = N + 2 * margin;
const fullGrid: boolean[][] = Array.from({ length: totalSize }, (_, r) =>
Array.from({ length: totalSize }, (_, c) => {
const mr = r - margin;
const mc = c - margin;
if (mr >= 0 && mr < N && mc >= 0 && mc < N) return matrix[mr][mc];
return false;
})
);
const lines: string[] = [];
for (let r = 0; r < totalSize; r += 2) {
let line = '';
for (let c = 0; c < totalSize; ++c) {
let top = fullGrid[r][c];
let bot = r + 1 < totalSize ? fullGrid[r + 1][c] : false;
if (invert) {
top = !top;
bot = !bot;
}
if (!top && !bot) {
line += '█';
} else if (top && !bot) {
line += '▄';
} else if (!top && bot) {
line += '▀';
} else {
line += ' ';
}
}
lines.push(line);
}
return lines.join('\n');
}
public static computeVerticalSpan(scratch: Uint8Array, r: number, c: number, w: number, N: number): number {
let h = 1;
while (r + h < N) {
const nextRowOffset = (r + h) * N;
let hasUnvisited = false;
for (let k = 0; k < w; ++k) {
const val = scratch[nextRowOffset + (c + k)];
if ((val & 2) === 0) return h;
if ((val & 4) === 0) {
hasUnvisited = true;
}
}
if (!hasUnvisited) return h;
h++;
}
return h;
}
public static packRectangles(scratch: Uint8Array, N: number, rectBuffer: Uint32Array): number {
let rectCount = 0;
const maxRects = rectBuffer.length;
for (let r = 0; r < N; ++r) {
const rowOffset = r * N;
for (let c = 0; c < N; ++c) {
const val = scratch[rowOffset + c];
if ((val & 2) === 0 || (val & 4) !== 0) continue;
let w = 1;
let lastUnvisitedW = 1;
while (c + w < N) {
const nextVal = scratch[rowOffset + (c + w)];
if ((nextVal & 2) === 0) break;
if ((nextVal & 4) === 0) {
lastUnvisitedW = w + 1;
}
w++;
}
w = lastUnvisitedW;
const h = QREncoder.computeVerticalSpan(scratch, r, c, w, N);
if (rectCount < maxRects) {
const packed = ((c << 24) | (r << 16) | (w << 8) | h) >>> 0;
rectBuffer[rectCount++] = packed;
}
for (let i = 0; i < h; ++i) {
const markRowOffset = (r + i) * N;
for (let j = 0; j < w; ++j) {
scratch[markRowOffset + (c + j)] |= 4;
}
}
c += w - 1;
}
}
return rectCount;
}
}
export namespace QREncoder {
export enum ECC {
Low = 'L',
Medium = 'M',
Quartile = 'Q',
High = 'H',
}
export type Payload = string | Uint8Array | readonly number[] | ArrayBufferView;
export type BooleanMatrix = boolean[][];
export interface VersionInfo {
version: number;
totalDataCodewords: number;
}
export interface LoggerLike {
log(message: string, level?: number): void;
}
export interface EncodeOptions {
ecc?: QREncoder.ECC | 'L' | 'M' | 'Q' | 'H';
maxVersion?: number;
scratchBuffer?: Uint8Array;
}
export interface AsciiOptions extends QREncoder.EncodeOptions {
margin?: number;
invert?: boolean;
}
export const ALIGNMENT_POSITIONS: ReadonlyArray<ReadonlyArray<number>> = Object.freeze([
[],
[6, 18],
[6, 22],
[6, 26],
[6, 30],
[6, 34],
[6, 22, 38],
[6, 24, 42],
[6, 26, 46],
[6, 28, 50],
[6, 30, 54],
[6, 32, 58],
[6, 34, 62],
[6, 26, 46, 66],
[6, 26, 48, 70],
[6, 26, 50, 74],
[6, 30, 54, 78],
[6, 30, 56, 82],
[6, 30, 58, 86],
[6, 34, 62, 90],
[6, 28, 50, 72, 94],
[6, 26, 50, 74, 98],
[6, 30, 54, 78, 102],
[6, 28, 54, 80, 106],
[6, 32, 58, 84, 110],
[6, 30, 58, 86, 114],
[6, 34, 62, 90, 118],
[6, 26, 50, 74, 98, 122],
[6, 30, 54, 78, 102, 126],
[6, 26, 52, 78, 104, 130],
[6, 30, 56, 82, 108, 134],
[6, 34, 60, 86, 112, 138],
[6, 30, 58, 86, 114, 142],
[6, 34, 62, 90, 118, 146],
[6, 30, 54, 78, 102, 126, 150],
[6, 24, 50, 76, 102, 128, 154],
[6, 28, 54, 80, 106, 132, 158],
[6, 32, 58, 84, 110, 136, 162],
[6, 26, 54, 82, 110, 138, 166],
[6, 30, 58, 86, 114, 142, 170],
]);
}
// --- SOURCE: node_modules\bf6-portal-utils\ui\components\qr-code\index.ts ---
export class UIQRCode extends UI.Element {
public static readonly MAX_QR_CODES = 128;
public static readonly MAX_QR_VERSION = 18;
public static readonly DEFAULT_MARGIN = 4;
public static readonly MIN_QUIET_ZONE = 4;
public static tickBudget = 10;
public static drawCost = 1.0;
public static updateCost = 0.25;
public static deleteCost = 0.5;
private static readonly MAX_QR_ORDER = 4 * UIQRCode.MAX_QR_VERSION + 17;
private static readonly MAX_MODULES = UIQRCode.MAX_QR_ORDER * UIQRCode.MAX_QR_ORDER;
private static readonly BASE_MODULE_SIZE = 10;
private static readonly _MAX_GENERATIONS = 65_535;
private static readonly _STATE_IDLE = 0;
private static readonly _STATE_DRAWING = 1;
private static readonly _STATE_UPDATING = 2;
private static readonly _STATE_DELETING = 3;
private static readonly _ECC_MASK = 0x3;
private static readonly _STATE_SHIFT = 2;
private static readonly _STATE_MASK = 0x3;
private static readonly _STATE_CLEAR_MASK = ~(UIQRCode._STATE_MASK << UIQRCode._STATE_SHIFT);
private static readonly _DIRTY_COLOR_MID_DRAW = 1 << 4;
private static _activeQrCodeCount: number = 0;
private static _firstFreeQrCode: number = 0;
private static readonly _generations = new Uint16Array(UIQRCode.MAX_QR_CODES);
private static readonly _nextFreeQrCode = new Int16Array(UIQRCode.MAX_QR_CODES);
private static readonly _elementToQRCodeSlot: Int16Array = UI.Element._elementToCustomSlot;
private static readonly _qrWidgets = new Array<mod.UIWidget | null>(UIQRCode.MAX_QR_CODES);
private static readonly _childWidgets = new Array<mod.UIWidget[] | null>(UIQRCode.MAX_QR_CODES);
protected static readonly _scratchBuffer = new Uint8Array(UIQRCode.MAX_MODULES);
private static readonly _pendingQrIds = new Int32Array(UIQRCode.MAX_QR_CODES);
private static _pendingQrHead = 0;
private static _pendingQrTail = 0;
private static _pendingQrCount = 0;
protected static readonly _rectBuffer = new Uint32Array(UIQRCode.MAX_MODULES);
private static _activeThrottledId: number = UI.Element._INVALID_INDEX;
protected static _rectCount = 0;
private static _rectCursor = 0;
private static _activeCellWidth = 0;
private static _activeCellHeight = 0;
private static _activeMargin = 0;
private static readonly _margins = new Uint8Array(UIQRCode.MAX_QR_CODES);
private static readonly _pendingData = new Array<UIQRCode.Payload | null>(UIQRCode.MAX_QR_CODES).fill(null);
private static _isSubscribed = false;
static {
for (let i = 0; i < UIQRCode.MAX_QR_CODES - 1; ++i) {
UIQRCode._nextFreeQrCode[i] = i + 1;
}
UIQRCode._nextFreeQrCode[UIQRCode.MAX_QR_CODES - 1] = UI.Element._INVALID_INDEX;
UIQRCode._generations.fill(0);
UIQRCode._qrWidgets.fill(null);
UIQRCode._childWidgets.fill(null);
UIQRCode._margins.fill(UIQRCode.DEFAULT_MARGIN);
UIQRCode._pendingData.fill(null);
UIQRCode._pendingQrIds.fill(UI.Element._INVALID_INDEX);
}
public static getActiveQRCodeCount(): number {
return UIQRCode._activeQrCodeCount;
}
private static _getState(slot: number): number {
return (UIQRCode._nextFreeQrCode[slot] >> UIQRCode._STATE_SHIFT) & UIQRCode._STATE_MASK;
}
private static _setState(slot: number, state: number): void {
UIQRCode._nextFreeQrCode[slot] =
(UIQRCode._nextFreeQrCode[slot] & UIQRCode._STATE_CLEAR_MASK) |
((state & UIQRCode._STATE_MASK) << UIQRCode._STATE_SHIFT);
}
private static _getMidDrawDirty(slot: number): boolean {
return (UIQRCode._nextFreeQrCode[slot] & UIQRCode._DIRTY_COLOR_MID_DRAW) !== 0;
}
private static _setMidDrawDirty(slot: number, dirty: boolean): void {
if (dirty) {
UIQRCode._nextFreeQrCode[slot] |= UIQRCode._DIRTY_COLOR_MID_DRAW;
} else {
UIQRCode._nextFreeQrCode[slot] &= ~UIQRCode._DIRTY_COLOR_MID_DRAW;
}
}
private static _getEcc(slot: number): number {
return UIQRCode._nextFreeQrCode[slot] & UIQRCode._ECC_MASK;
}
private static _setEcc(slot: number, eccIdx: number): void {
UIQRCode._nextFreeQrCode[slot] =
(UIQRCode._nextFreeQrCode[slot] & ~UIQRCode._ECC_MASK) | (eccIdx & UIQRCode._ECC_MASK);
}
protected static _resolveQrCodeSlot(elementId: number): number {
const elementSlot = UI.Element._resolveSlot(elementId);
if (elementSlot === UI.Element._INVALID_INDEX) return UI.Element._INVALID_INDEX;
return UIQRCode._elementToQRCodeSlot[elementSlot];
}
private static _resetRects(): void {
UIQRCode._rectCount = 0;
UIQRCode._rectCursor = 0;
}
private static _activateQr(elementId: number): boolean {
const elementSlot = UI.Element._resolveSlot(elementId);
if (elementSlot === UI.Element._INVALID_INDEX) return false;
const qrSlot = UIQRCode._elementToQRCodeSlot[elementSlot];
if (qrSlot === UI.Element._INVALID_INDEX) return false;
const data = UIQRCode._pendingData[qrSlot];
if (data == null) return false;
const eccIdx = UIQRCode._getEcc(qrSlot);
UIQRCode._activeThrottledId = elementId;
UIQRCode._resetRects();
const size = QREncoder.encodeToBuffer(
data,
eccIdx,
UIQRCode._scratchBuffer,
UIQRCode.MAX_QR_VERSION,
UIQRCode._logging
);
UIQRCode._pendingData[qrSlot] = null;
if (size <= 0) {
UIQRCode._activeThrottledId = UI.Element._INVALID_INDEX;
return false;
}
const margin = UIQRCode._margins[qrSlot];
const width = UI.Element._getWidth(elementSlot);
const height = UI.Element._getHeight(elementSlot);
const qrSize = Math.min(width, height);
const gridUnits = size + 2 * margin;
UIQRCode._activeMargin = margin;
UIQRCode._activeCellWidth = qrSize / gridUnits;
UIQRCode._activeCellHeight = qrSize / gridUnits;
UIQRCode._packRectangles(size);
UIQRCode._childWidgets[qrSlot] = new Array<mod.UIWidget>(UIQRCode._rectCount);
if (UIQRCode._rectCount === 0) {
UIQRCode._setState(qrSlot, UIQRCode._STATE_IDLE);
UIQRCode._endActiveOperation();
}
return true;
}
private static _activateUpdate(elementId: number): boolean {
const qrSlot = UIQRCode._resolveQrCodeSlot(elementId);
if (qrSlot === UI.Element._INVALID_INDEX) return false;
const darkWidgets = UIQRCode._childWidgets[qrSlot];
if (!darkWidgets || darkWidgets.length === 0) {
UIQRCode._setState(qrSlot, UIQRCode._STATE_IDLE);
return false;
}
UIQRCode._activeThrottledId = elementId;
UIQRCode._rectCursor = 0;
UIQRCode._rectCount = darkWidgets.length;
return true;
}
private static _activateDelete(elementId: number): boolean {
const qrSlot = UIQRCode._resolveQrCodeSlot(elementId);
if (qrSlot === UI.Element._INVALID_INDEX) return false;
UIQRCode._pendingData[qrSlot] = null;
UIQRCode._activeThrottledId = elementId;
UIQRCode._rectCursor = 0;
UIQRCode._rectCount = UIQRCode._childWidgets[qrSlot]?.length ?? 0;
return true;
}
private static _activateNext(elementId: number): boolean {
const qrSlot = UIQRCode._resolveQrCodeSlot(elementId);
if (qrSlot === UI.Element._INVALID_INDEX) return false;
const state = UIQRCode._getState(qrSlot);
if (state === UIQRCode._STATE_DRAWING) return UIQRCode._activateQr(elementId);
if (state === UIQRCode._STATE_UPDATING) return UIQRCode._activateUpdate(elementId);
if (state === UIQRCode._STATE_DELETING) return UIQRCode._activateDelete(elementId);
return false;
}
private static _endActiveOperation(): void {
UIQRCode._activeThrottledId = UI.Element._INVALID_INDEX;
UIQRCode._resetRects();
}
private static _drawBatch(budget: number): number {
const elementId = UIQRCode._activeThrottledId;
if (elementId === UI.Element._INVALID_INDEX) return 0;
const elementSlot = UI.Element._resolveSlot(elementId);
if (elementSlot === UI.Element._INVALID_INDEX) {
UIQRCode._endActiveOperation();
return 0;
}
const qrSlot = UIQRCode._elementToQRCodeSlot[elementSlot];
if (qrSlot === UI.Element._INVALID_INDEX) {
UIQRCode._endActiveOperation();
return 0;
}
const parentWidget = UIQRCode._qrWidgets[qrSlot];
if (!parentWidget) {
UIQRCode._endActiveOperation();
return 0;
}
const darkWidgets = UIQRCode._childWidgets[qrSlot];
if (!darkWidgets) {
UIQRCode._endActiveOperation();
return 0;
}
const margin = UIQRCode._activeMargin;
const cellWidth = UIQRCode._activeCellWidth;
const cellHeight = UIQRCode._activeCellHeight;
const darkColor = UI.Element._getForegroundColor(elementSlot);
const darkVec = Colors.toVector(darkColor);
const nativeSolidFill = UI.Element._getNativeBgFill(UI.BgFill.Solid);
const qrInstance = UI.Element._getInstance(elementSlot) as UIQRCode | undefined;
if (!qrInstance || !qrInstance._isValid) {
UIQRCode._endActiveOperation();
return 0;
}
const receiver = qrInstance._receiver;
const depth = qrInstance.depth ?? UI.Depth.AboveGameUI;
const nativeDepth = UI.Element._getNativeDepth(depth);
const nativeTopLeft = UI.Element._getNativeAnchor(UI.Anchor.TopLeft);
let drawn = 0;
while (UIQRCode._rectCursor < UIQRCode._rectCount && drawn < budget) {
const cursor = UIQRCode._rectCursor;
const packed = UIQRCode._rectBuffer[cursor];
const col = (packed >>> 24) & 0xff;
const row = (packed >>> 16) & 0xff;
const spanW = (packed >>> 8) & 0xff;
const spanH = packed & 0xff;
const x0 = Math.round((col + margin) * cellWidth);
const y0 = Math.round((row + margin) * cellHeight);
const x1 = Math.round((col + spanW + margin) * cellWidth);
const y1 = Math.round((row + spanH + margin) * cellHeight);
const w = Math.max(1, x1 - x0);
const h = Math.max(1, y1 - y0);
const childName = `ui_qr_${elementId}_${cursor + 1}`;
if (!receiver || !receiver.nativeReceiver) {
mod.AddUIContainer(
childName,
mod.CreateVector(x0 - 0.01, y0 - 0.01, 0),
mod.CreateVector(w + 0.02, h + 0.02, 0),
nativeTopLeft,
parentWidget,
true,
0,
darkVec,
1,
nativeSolidFill,
nativeDepth
);
} else {
mod.AddUIContainer(
childName,
mod.CreateVector(x0 - 0.01, y0 - 0.01, 0),
mod.CreateVector(w + 0.02, h + 0.02, 0),
nativeTopLeft,
parentWidget,
true,
0,
darkVec,
1,
nativeSolidFill,
nativeDepth,
receiver.nativeReceiver
);
}
darkWidgets[cursor] = mod.FindUIWidgetWithName(childName) as mod.UIWidget;
UIQRCode._rectCursor++;
drawn++;
}
if (UIQRCode._rectCursor < UIQRCode._rectCount) return drawn;
if (UIQRCode._getMidDrawDirty(qrSlot)) {
UIQRCode._setMidDrawDirty(qrSlot, false);
UIQRCode._setState(qrSlot, UIQRCode._STATE_UPDATING);
UIQRCode._rectCursor = 0;
} else {
UIQRCode._setState(qrSlot, UIQRCode._STATE_IDLE);
UIQRCode._endActiveOperation();
}
return drawn;
}
private static _updateBatch(budget: number): number {
const elementId = UIQRCode._activeThrottledId;
if (elementId === UI.Element._INVALID_INDEX) return 0;
const elementSlot = UI.Element._resolveSlot(elementId);
if (elementSlot === UI.Element._INVALID_INDEX) {
UIQRCode._endActiveOperation();
return 0;
}
const qrSlot = UIQRCode._elementToQRCodeSlot[elementSlot];
if (qrSlot === UI.Element._INVALID_INDEX) {
UIQRCode._endActiveOperation();
return 0;
}
const darkWidgets = UIQRCode._childWidgets[qrSlot];
if (!darkWidgets || darkWidgets.length === 0) {
UIQRCode._setState(qrSlot, UIQRCode._STATE_IDLE);
UIQRCode._endActiveOperation();
return 0;
}
const color = UI.Element._getForegroundColor(elementSlot);
const darkVec = Colors.toVector(color);
let updated = 0;
while (UIQRCode._rectCursor < UIQRCode._rectCount && updated < budget) {
const w = darkWidgets[UIQRCode._rectCursor];
if (w) {
mod.SetUIWidgetBgColor(w, darkVec);
}
UIQRCode._rectCursor++;
updated++;
}
if (UIQRCode._rectCursor >= UIQRCode._rectCount) {
UIQRCode._setState(qrSlot, UIQRCode._STATE_IDLE);
UIQRCode._endActiveOperation();
}
return updated;
}
private static _deleteBatch(budget: number): number {
const elementId = UIQRCode._activeThrottledId;
if (elementId === UI.Element._INVALID_INDEX) return 0;
const elementSlot = UI.Element._resolveSlot(elementId);
if (elementSlot === UI.Element._INVALID_INDEX) {
UIQRCode._endActiveOperation();
return 0;
}
const qrSlot = UIQRCode._elementToQRCodeSlot[elementSlot];
if (qrSlot === UI.Element._INVALID_INDEX) {
UIQRCode._endActiveOperation();
return 0;
}
const darkWidgets = UIQRCode._childWidgets[qrSlot];
let deleted = 0;
if (darkWidgets) {
while (UIQRCode._rectCursor < UIQRCode._rectCount && deleted < budget) {
const w = darkWidgets[UIQRCode._rectCursor];
if (w) {
mod.DeleteUIWidget(w);
darkWidgets[UIQRCode._rectCursor] = null as unknown as mod.UIWidget;
}
UIQRCode._rectCursor++;
deleted++;
}
}
if (UIQRCode._rectCursor < UIQRCode._rectCount) return deleted;
if (darkWidgets) {
darkWidgets.length = 0;
UIQRCode._childWidgets[qrSlot] = null;
}
const qrWidget = UIQRCode._qrWidgets[qrSlot];
if (qrWidget) {
mod.DeleteUIWidget(qrWidget);
UIQRCode._qrWidgets[qrSlot] = null;
}
const instance = UI.Element._getInstance(elementSlot) as UIQRCode | undefined;
UIQRCode._endActiveOperation();
if (instance) {
instance._finalizeDelete();
}
return deleted;
}
private static _pushPendingQr(elementId: number): void {
if (UIQRCode._pendingQrCount >= UIQRCode.MAX_QR_CODES) {
UIQRCode._logging.log('Pending QR queue overflow', UI.LogLevel.Error);
return;
}
UIQRCode._pendingQrIds[UIQRCode._pendingQrTail] = elementId;
UIQRCode._pendingQrTail = (UIQRCode._pendingQrTail + 1) % UIQRCode.MAX_QR_CODES;
UIQRCode._pendingQrCount++;
}
private static _popPendingQr(): number | null {
while (UIQRCode._pendingQrCount > 0) {
const elementId = UIQRCode._pendingQrIds[UIQRCode._pendingQrHead];
UIQRCode._pendingQrHead = (UIQRCode._pendingQrHead + 1) % UIQRCode.MAX_QR_CODES;
UIQRCode._pendingQrCount--;
const qrSlot = UIQRCode._resolveQrCodeSlot(elementId);
if (qrSlot !== UI.Element._INVALID_INDEX) return elementId;
}
return null;
}
private static _handleTick = (): void => {
let budget = UIQRCode.tickBudget;
while (budget > 0.001) {
if (UIQRCode._activeThrottledId === UI.Element._INVALID_INDEX) {
const nextId = UIQRCode._popPendingQr();
if (nextId === null) break;
if (!UIQRCode._activateNext(nextId)) continue;
}
if (UIQRCode._activeThrottledId === UI.Element._INVALID_INDEX) continue;
const qrSlot = UIQRCode._resolveQrCodeSlot(UIQRCode._activeThrottledId);
if (qrSlot === UI.Element._INVALID_INDEX) {
UIQRCode._endActiveOperation();
continue;
}
const state = UIQRCode._getState(qrSlot);
if (state === UIQRCode._STATE_DRAWING) {
const cost = Math.max(0.001, UIQRCode.drawCost);
const allowed = Math.max(1, Math.floor(budget / cost));
const drawn = UIQRCode._drawBatch(allowed);
if (drawn === 0) {
UIQRCode._endActiveOperation();
continue;
}
budget -= drawn * cost;
if (
UIQRCode._activeThrottledId !== UI.Element._INVALID_INDEX &&
UIQRCode._getState(qrSlot) === UIQRCode._STATE_DRAWING &&
UIQRCode._rectCursor < UIQRCode._rectCount
) {
break;
}
} else if (state === UIQRCode._STATE_UPDATING) {
const cost = Math.max(0.001, UIQRCode.updateCost);
const allowed = Math.max(1, Math.floor(budget / cost));
const updated = UIQRCode._updateBatch(allowed);
if (updated === 0) {
UIQRCode._endActiveOperation();
continue;
}
budget -= updated * cost;
if (
UIQRCode._activeThrottledId !== UI.Element._INVALID_INDEX &&
UIQRCode._rectCursor < UIQRCode._rectCount
) {
break;
}
} else if (state === UIQRCode._STATE_DELETING) {
const cost = Math.max(0.001, UIQRCode.deleteCost);
const allowed = Math.max(1, Math.floor(budget / cost));
const deleted = UIQRCode._deleteBatch(allowed);
if (deleted === 0) {
UIQRCode._endActiveOperation();
continue;
}
budget -= deleted * cost;
if (
UIQRCode._activeThrottledId !== UI.Element._INVALID_INDEX &&
UIQRCode._rectCursor < UIQRCode._rectCount
) {
break;
}
} else {
UIQRCode._endActiveOperation();
}
}
};
private static _ensureTickSubscribed(): void {
if (UIQRCode._isSubscribed) return;
UIQRCode._isSubscribed = true;
Events.OnTickStart.subscribe(UIQRCode._handleTick, Events.EventPriority.Last);
}
protected static _packRectangles(N: number): void {
UIQRCode._resetRects();
UIQRCode._rectCount = QREncoder.packRectangles(UIQRCode._scratchBuffer, N, UIQRCode._rectBuffer);
}
public constructor(params: UIQRCode.Params) {
super(params);
if (!params || this._slot === UI.Element._INVALID_INDEX) return;
const scale = params.scale ?? 1;
const margin = Math.max(UIQRCode.MIN_QUIET_ZONE, Math.floor(params.margin ?? UIQRCode.DEFAULT_MARGIN));
if (params.data == null) {
UIQRCode._logging.log('Missing or null data', UI.LogLevel.Error);
super.delete();
return;
}
const ecc = params.ecc ?? UIQRCode.ECC.Medium;
const eccIdx = QREncoder.getEccIndex(ecc);
const byteLen = QREncoder.getDataByteLength(params.data);
const versionInfo = byteLen >= 0 ? QREncoder.selectVersion(byteLen, eccIdx, UIQRCode.MAX_QR_VERSION) : null;
if (byteLen < 0 || !versionInfo || versionInfo.version > UIQRCode.MAX_QR_VERSION) {
UIQRCode._logging.log(
`Data exceeds capacity of configured MAX_QR_VERSION (V${UIQRCode.MAX_QR_VERSION}) (${byteLen} bytes requires V${versionInfo?.version})`,
UI.LogLevel.Error
);
super.delete();
return;
}
const qrSlot = this._allocateQrCodeSlot();
if (qrSlot === UI.Element._INVALID_INDEX) {
super.delete();
return;
}
UIQRCode._margins[qrSlot] = margin;
const matrixSize = 17 + 4 * versionInfo.version;
const totalUnits = matrixSize + 2 * margin;
const defaultQrSize = totalUnits > 0 ? totalUnits * UIQRCode.BASE_MODULE_SIZE * scale : 100;
const baseWidth = params.width ?? params.size?.width ?? defaultQrSize;
const baseHeight = params.height ?? params.size?.height ?? defaultQrSize;
const qrSize = Math.min(baseWidth, baseHeight);
const qrWidth = qrSize;
const qrHeight = qrSize;
const bgColor = params.bgColor ?? UI.COLORS.WHITE;
const bgAlpha = params.bgAlpha ?? 1;
const bgFill = params.bgFill ?? UI.BgFill.Solid;
const color = params.color ?? UI.COLORS.BLACK;
const { x, y } = UI.Element._getPosition(params);
const parent = params.parent ?? UI.ROOT_NODE;
const receiver = this._receiver!;
const name = this._name;
const anchor = params.anchor ?? UI.Anchor.Center;
const visible = params.visible ?? true;
const depth = params.depth ?? UI.Depth.AboveGameUI;
const nativeAnchor = UI.Element._getNativeAnchor(anchor);
const nativeCenterAnchor = UI.Element._getNativeAnchor(UI.Anchor.Center);
const nativeDepth = UI.Element._getNativeDepth(depth);
const nativeLightFill = UI.Element._getNativeBgFill(bgFill);
const nativeBgFillNone = UI.Element._getNativeBgFill(UI.BgFill.None);
if (!receiver.nativeReceiver) {
mod.AddUIContainer(
name,
mod.CreateVector(x, y, 0),
mod.CreateVector(baseWidth, baseHeight, 0),
nativeAnchor,
UI.Element._getNativeWidget(parent)!,
visible,
0,
Colors.toVector(bgColor),
bgAlpha,
nativeLightFill,
nativeDepth
);
} else {
mod.AddUIContainer(
name,
mod.CreateVector(x, y, 0),
mod.CreateVector(baseWidth, baseHeight, 0),
nativeAnchor,
UI.Element._getNativeWidget(parent)!,
visible,
0,
Colors.toVector(bgColor),
bgAlpha,
nativeLightFill,
nativeDepth,
receiver.nativeReceiver
);
}
this._bindNativeWidget(name);
this.setSize({ width: baseWidth, height: baseHeight });
super.setBgColor(bgColor);
super.setBgAlpha(bgAlpha);
super.setBgFill(bgFill);
const baseContainerWidget = this._uiWidget!;
const qrName = `${name}_qr`;
if (!receiver.nativeReceiver) {
mod.AddUIContainer(
qrName,
UI.ZERO_VECTOR,
mod.CreateVector(qrWidth, qrHeight, 0),
nativeCenterAnchor,
baseContainerWidget,
true,
0,
UI.ZERO_VECTOR,
0,
nativeBgFillNone,
nativeDepth
);
} else {
mod.AddUIContainer(
qrName,
UI.ZERO_VECTOR,
mod.CreateVector(qrWidth, qrHeight, 0),
nativeCenterAnchor,
baseContainerWidget,
true,
0,
UI.ZERO_VECTOR,
0,
nativeBgFillNone,
nativeDepth,
receiver.nativeReceiver
);
}
UIQRCode._qrWidgets[qrSlot] = mod.FindUIWidgetWithName(qrName) as mod.UIWidget;
UI.Element._setForegroundColor(this._slot, color);
UIQRCode._pendingData[qrSlot] = params.data;
UIQRCode._setEcc(qrSlot, eccIdx);
UIQRCode._setState(qrSlot, UIQRCode._STATE_DRAWING);
UIQRCode._ensureTickSubscribed();
UIQRCode._pushPendingQr(this._id);
}
protected get _qrCodeSlot(): number {
const slot = this._slot;
return slot !== UI.Element._INVALID_INDEX ? UIQRCode._elementToQRCodeSlot[slot] : UI.Element._INVALID_INDEX;
}
protected override get _isValid(): boolean {
return this._slot !== UI.Element._INVALID_INDEX;
}
public override get isDeleted(): boolean {
if (super.isDeleted) return true;
const qrSlot = this._qrCodeSlot;
if (qrSlot === UI.Element._INVALID_INDEX) return true;
return UIQRCode._getState(qrSlot) === UIQRCode._STATE_DELETING;
}
protected _resolveQrCodeSlotAndLogWarning(): number {
const qrSlot = this._qrCodeSlot;
if (qrSlot === UI.Element._INVALID_INDEX) {
UIQRCode._logging.log(`QR code is deleted`, UI.LogLevel.Warning);
return UI.Element._INVALID_INDEX;
}
return qrSlot;
}
protected override _getIsInvalidAndLogWarning(): boolean {
return this._resolveQrCodeSlotAndLogWarning() === UI.Element._INVALID_INDEX;
}
private _allocateQrCodeSlot(): number {
const elementSlot = this._slot;
if (elementSlot < 0 || elementSlot >= UI.MAX_ELEMENTS) return UI.Element._INVALID_INDEX;
if (UIQRCode._firstFreeQrCode === UI.Element._INVALID_INDEX) {
UIQRCode._logging.log('QR code pool is full', UI.LogLevel.Error);
return UI.Element._INVALID_INDEX;
}
const slot = UIQRCode._firstFreeQrCode;
UIQRCode._firstFreeQrCode = UIQRCode._nextFreeQrCode[slot];
UIQRCode._nextFreeQrCode[slot] = (UIQRCode._STATE_DRAWING << 2) | 0;
UIQRCode._childWidgets[slot] = null;
UIQRCode._elementToQRCodeSlot[elementSlot] = slot;
UIQRCode._margins[slot] = UIQRCode.DEFAULT_MARGIN;
UIQRCode._pendingData[slot] = null;
UIQRCode._activeQrCodeCount++;
return slot;
}
private _freeQrCodeSlot(): void {
const elementSlot = this._slot;
if (elementSlot < 0 || elementSlot >= UI.MAX_ELEMENTS) return;
const slot = UIQRCode._elementToQRCodeSlot[elementSlot];
if (slot === UI.Element._INVALID_INDEX || slot < 0 || slot >= UIQRCode.MAX_QR_CODES) return;
UIQRCode._qrWidgets[slot] = null;
if (UIQRCode._childWidgets[slot]) {
UIQRCode._childWidgets[slot]!.length = 0;
UIQRCode._childWidgets[slot] = null;
}
UIQRCode._pendingData[slot] = null;
UIQRCode._margins[slot] = UIQRCode.DEFAULT_MARGIN;
UIQRCode._elementToQRCodeSlot[elementSlot] = UI.Element._INVALID_INDEX;
UIQRCode._activeQrCodeCount--;
if (UIQRCode._generations[slot] < UIQRCode._MAX_GENERATIONS) {
UIQRCode._generations[slot]++;
UIQRCode._nextFreeQrCode[slot] = UIQRCode._firstFreeQrCode;
UIQRCode._firstFreeQrCode = slot;
} else if (UIQRCode._logging.willLog(UI.LogLevel.Warning)) {
UIQRCode._logging.log(
`QR code slot ${slot} exhausted max generations and was retired`,
UI.LogLevel.Warning
);
}
}
protected get _qrWidget(): mod.UIWidget | null {
const slot = this._qrCodeSlot;
return slot === UI.Element._INVALID_INDEX ? null : UIQRCode._qrWidgets[slot];
}
protected override _handleFlush(flags: number, widget: mod.UIWidget): void {
super._handleFlush(flags, widget);
const slot = this._slot;
const qrSlot = this._qrCodeSlot;
if (qrSlot === UI.Element._INVALID_INDEX) return;
const dirtyFgColor = (flags & UI.Element._DIRTY_FOREGROUND_COLOR) !== 0;
if (!dirtyFgColor) return;
const darkWidgets = UIQRCode._childWidgets[qrSlot];
if (!darkWidgets) return;
const fgColorVec = Colors.toVector(UI.Element._getForegroundColor(slot));
for (let i = 0; i < darkWidgets.length; ++i) {
const childWidget = darkWidgets[i];
if (!childWidget) continue;
mod.SetUIWidgetBgColor(childWidget, fgColorVec);
}
}
protected _finalizeDelete(): void {
this._freeQrCodeSlot();
super.delete();
}
public override delete(): void {
if (this.isDeleted) return;
const qrSlot = this._qrCodeSlot;
if (qrSlot === UI.Element._INVALID_INDEX) return;
const currentState = UIQRCode._getState(qrSlot);
if (currentState === UIQRCode._STATE_DELETING) return;
const darkWidgets = UIQRCode._childWidgets[qrSlot];
if (!darkWidgets || darkWidgets.length === 0) {
if (this._id === UIQRCode._activeThrottledId) {
UIQRCode._endActiveOperation();
}
const qrWidget = UIQRCode._qrWidgets[qrSlot];
if (qrWidget) {
mod.DeleteUIWidget(qrWidget);
UIQRCode._qrWidgets[qrSlot] = null;
}
this._finalizeDelete();
return;
}
UIQRCode._setState(qrSlot, UIQRCode._STATE_DELETING);
UIQRCode._setMidDrawDirty(qrSlot, false);
if (this._id === UIQRCode._activeThrottledId) {
const countToDelete = currentState === UIQRCode._STATE_DRAWING ? UIQRCode._rectCursor : darkWidgets.length;
UIQRCode._rectCursor = 0;
UIQRCode._rectCount = countToDelete;
} else if (currentState === UIQRCode._STATE_IDLE) {
UIQRCode._ensureTickSubscribed();
UIQRCode._pushPendingQr(this._id);
}
}
public get state(): UIQRCode.State | undefined {
if (this.isDeleted) return undefined;
const qrSlot = this._qrCodeSlot;
if (qrSlot === UI.Element._INVALID_INDEX) return undefined;
return UIQRCode._getState(qrSlot);
}
public get progress(): number | undefined {
if (this.isDeleted) return undefined;
const qrSlot = this._qrCodeSlot;
if (qrSlot === UI.Element._INVALID_INDEX) return undefined;
const state = UIQRCode._getState(qrSlot);
if (state === UIQRCode._STATE_IDLE) return 100;
if (this._id === UIQRCode._activeThrottledId) {
return UIQRCode._rectCount > 0 ? Math.floor((UIQRCode._rectCursor / UIQRCode._rectCount) * 100) : 100;
}
return 0;
}
public get isReady(): boolean | undefined {
if (this.isDeleted) return undefined;
const qrSlot = this._qrCodeSlot;
if (qrSlot === UI.Element._INVALID_INDEX) return undefined;
const state = UIQRCode._getState(qrSlot);
return state === UIQRCode._STATE_IDLE;
}
public get drawCallCount(): number | undefined {
if (this.isDeleted) return undefined;
const slot = this._qrCodeSlot;
if (slot === UI.Element._INVALID_INDEX) return undefined;
const widgets = UIQRCode._childWidgets[slot];
let count = 2;
if (!widgets) return count;
for (let i = 0; i < widgets.length; ++i) {
if (widgets[i]) {
count++;
}
}
return count;
}
public get color(): Colors.Color | undefined {
if (this.isDeleted) return undefined;
const slot = this._slot;
return slot === UI.Element._INVALID_INDEX ? undefined : UI.Element._getForegroundColor(slot);
}
public getColor(out?: Colors.Color): Colors.Color | undefined {
if (this.isDeleted) return undefined;
const slot = this._slot;
return slot === UI.Element._INVALID_INDEX ? undefined : UI.Element._getForegroundColor(slot, out);
}
public set color(color: Colors.Color) {
this.setColor(color);
}
public setColor(color: Colors.Color): this {
const elementSlot = this._getSlotAndLogWarning();
if (elementSlot === UI.Element._INVALID_INDEX) return this;
const qrSlot = this._resolveQrCodeSlotAndLogWarning();
if (qrSlot === UI.Element._INVALID_INDEX) return this;
if (UI.Element._setForegroundColor(elementSlot, color)) {
UI.Element._markDirty(elementSlot, UI.Element._DIRTY_FOREGROUND_COLOR);
}
const state = UIQRCode._getState(qrSlot);
if (state === UIQRCode._STATE_DELETING) return this;
if (state === UIQRCode._STATE_DRAWING) {
if (this._id === UIQRCode._activeThrottledId && UIQRCode._rectCursor > 0) {
UIQRCode._setMidDrawDirty(qrSlot, true);
}
return this;
}
UIQRCode._setState(qrSlot, UIQRCode._STATE_UPDATING);
const darkWidgets = UIQRCode._childWidgets[qrSlot];
if (!darkWidgets || darkWidgets.length === 0) {
UIQRCode._setState(qrSlot, UIQRCode._STATE_IDLE);
return this;
}
if (this._id === UIQRCode._activeThrottledId) {
UIQRCode._rectCursor = 0;
UIQRCode._rectCount = darkWidgets.length;
} else if (state === UIQRCode._STATE_IDLE) {
UIQRCode._ensureTickSubscribed();
UIQRCode._pushPendingQr(this._id);
}
return this;
}
}
export namespace UIQRCode {
export enum State {
Idle = 0,
Drawing = 1,
Updating = 2,
Deleting = 3,
}
export import ECC = QREncoder.ECC;
export type Payload = QREncoder.Payload;
export type Params = UI.ElementParams & {
data: Payload;
ecc?: ECC;
scale?: number;
margin?: number;
color?: Colors.Color;
};
}
// --- SOURCE: src\ui.ts ---
export type Text = string | mod.Message;
export function K(key: string): mod.Message {
return mod.Message(key);
}
export function S(lit: string): mod.Message {
const key = SCENE_TEXT[lit];
if (key === undefined) {
reportMissingKey(lit, "scene literal");
return mod.Message(T.logBadMessage);
}
return mod.Message(key);
}
export function charKey(ch: string): string | undefined {
return CHAR_KEY[ch];
}
export function msgFor(t: string | number | mod.Message): mod.Message {
if (typeof t === "number") return mod.Message(TPL.num1, t);
if (typeof t !== "string") return t;
const scene = SCENE_TEXT[t];
if (scene !== undefined) return mod.Message(scene);
const curated = (T as Record<string, string>)[t];
if (curated !== undefined) return mod.Message(curated);
reportMissingKey(t, "field or node text");
return mod.Message(T.logBadMessage);
}
export function rowTextKey(r: Row): string {
return r.type === "screen" ? r.key : r.type === "tpl" ? templateNameKey(r.tpl) : r.entry.key;
}
export function rowCatTextKey(r: Row): string {
return r.type === "screen" ? r.catKey : r.type === "tpl" ? T.logEmpty : r.entry.catKey;
}
type WidgetSpec = Omit<SceneNode, "text"> & { readonly text?: string | mod.Message };
type WidgetNode = SceneNode | WidgetSpec;
export type Scope = Record<string, string | number | mod.Message>;
export type Fields = Record<string, Scope>;
const P = PALETTE as Record<string, string>;
export type Tab = "sfx" | "vfx" | "fav" | "music" | "radio";
export function isTesterTab(tab: Tab): tab is "music" | "radio" {
return tab === "music" || tab === "radio";
}
export type ScreenRow = { readonly type: "screen"; readonly id: string; readonly display: string; readonly category: string; readonly key: string; readonly catKey: string };
export type Row =
| { readonly type: "sfx"; readonly entry: SfxEntry }
| { readonly type: "spawn"; readonly entry: VfxEntry }
| { readonly type: "tpl"; readonly tpl: Template }
| ScreenRow;
export function rowKey(r: Row): string {
return r.type === "screen" ? "screen:" + r.id : r.type === "tpl" ? "tpl" + r.tpl.n : r.entry.name;
}
export function rowDisplay(r: Row): string {
return r.type === "screen" ? r.display : r.type === "tpl" ? templateName(r.tpl) : r.entry.display;
}
export function rowCategory(r: Row): string {
return r.type === "screen" ? r.category : r.type === "tpl" ? "Template" : r.entry.category;
}
export function rowRawName(r: Row): string {
return r.type === "screen" ? r.display : r.type === "tpl" ? templateName(r.tpl) : r.entry.name;
}
export interface FilterState {
query: string;
dim: string;
kind: string;
vfx: string;
}
export const NO_FILTERS: FilterState = { query: "", dim: "", kind: "", vfx: "" };
export const MAX_QUERY = 24;
function matches(r: Row, tab: Tab, f: FilterState): boolean {
if (r.type === "tpl") return true;
if (tab === "sfx") {
if (r.type !== "sfx") return false;
if (f.dim !== "" && r.entry.dim !== f.dim) return false;
if (f.kind !== "" && r.entry.kind !== f.kind) return false;
} else {
if (f.vfx === "world" && r.type !== "spawn") return false;
if (f.vfx === "screen" && r.type !== "screen") return false;
}
return true;
}
function matchesQuery(r: Row, q: string): boolean {
if (q === "") return true;
const needle = q.toLowerCase();
return rowDisplay(r).toLowerCase().indexOf(needle) >= 0 || rowRawName(r).toLowerCase().indexOf(needle) >= 0;
}
const rgbCache: Record<string, UI.Color> = {};
export function rgb(hex: string): UI.Color {
let c = rgbCache[hex];
if (c === undefined) {
const n = parseInt(hex.slice(1), 16);
c = { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
rgbCache[hex] = c;
}
return c;
}
function scaleRgb(c: UI.Color, k: number): UI.Color {
return { r: Math.min(1, c.r * k), g: Math.min(1, c.g * k), b: Math.min(1, c.b * k) };
}
interface RgbPalette {
base: UI.Color;
disabled: UI.Color;
pressed: UI.Color;
hover: UI.Color;
focused: UI.Color;
}
const buttonCache: Record<string, RgbPalette> = {};
function buttonPalette(hex: string): RgbPalette {
let p = buttonCache[hex];
if (p === undefined) {
const base = rgb(hex);
p = {
base: base,
disabled: scaleRgb(base, 0.5),
pressed: rgb(P.hot),
hover: rgb(P.hot),
focused: rgb(P.hot),
};
buttonCache[hex] = p;
}
return p;
}
const FILL_CACHE: Record<string, UI.BgFill> = {};
function uiFill(name: string | undefined): UI.BgFill {
const key = name ?? "None";
let v = FILL_CACHE[key];
if (v === undefined) {
switch (key) {
case "Solid": v = UI.BgFill.Solid; break;
case "Blur": v = UI.BgFill.Blur; break;
case "OutlineThin": v = UI.BgFill.OutlineThin; break;
case "OutlineThick": v = UI.BgFill.OutlineThick; break;
case "GradientBottom": v = UI.BgFill.GradientBottom; break;
case "GradientTop": v = UI.BgFill.GradientTop; break;
case "GradientLeft": v = UI.BgFill.GradientLeft; break;
case "GradientRight": v = UI.BgFill.GradientRight; break;
default: v = UI.BgFill.None;
}
FILL_CACHE[key] = v;
}
return v;
}
const ANCHOR_CACHE: Record<string, UI.Anchor> = {};
function uiAnchor(name: string | undefined): UI.Anchor {
const key = name ?? "Center";
let v = ANCHOR_CACHE[key];
if (v === undefined) {
switch (key) {
case "Left": case "CenterLeft": v = UI.Anchor.CenterLeft; break;
case "Right": case "CenterRight": v = UI.Anchor.CenterRight; break;
case "TopLeft": v = UI.Anchor.TopLeft; break;
case "TopRight": v = UI.Anchor.TopRight; break;
case "TopCenter": v = UI.Anchor.TopCenter; break;
case "BottomCenter": v = UI.Anchor.BottomCenter; break;
case "BottomLeft": v = UI.Anchor.BottomLeft; break;
case "BottomRight": v = UI.Anchor.BottomRight; break;
default: v = UI.Anchor.Center;
}
ANCHOR_CACHE[key] = v;
}
return v;
}
function resolveToken(tok: string, fields: Fields): string | number | mod.Message {
const body = tok.slice(2, tok.length - 2);
const dot = body.indexOf(".");
if (dot < 0) return body;
const g = fields[body.slice(0, dot)];
if (g === undefined) return body;
const v = g[body.slice(dot + 1)];
return v === undefined ? body : v;
}
function prop(n: WidgetNode, key: string, fields: Fields, scope: string): string | number | mod.Message | undefined {
return rawProp(n, key, fields, scope);
}
function propStr(n: WidgetNode, key: string, fields: Fields, scope: string): string | undefined {
const v = rawProp(n, key, fields, scope);
return typeof v === "string" ? v : v === undefined ? undefined : String(v);
}
function rawProp(n: WidgetNode, key: string, fields: Fields, scope: string): string | number | mod.Message | undefined {
const binds = n.bind;
if (binds !== undefined) {
const bound = binds[key];
if (bound !== undefined) {
const s = fields[scope];
if (s !== undefined) {
const v = s[bound];
if (v !== undefined) return v;
}
}
}
const raw = (n as unknown as Record<string, unknown>)[key];
if (raw === undefined) return undefined;
if (typeof raw === "string" && raw.startsWith("{{")) return resolveToken(raw, fields);
return raw as string | number | mod.Message;
}
export function truncate(s: string, max: number): string {
return s.length <= max ? s : s.slice(0, max - 1) + "...";
}
let SFX_GROUPS: string[] = [];
let EXTRA_CAT_KEYS: Record<string, string> = {};
let VFX_GROUPS: string[] = [];
let SCREEN_ROWS: ScreenRow[] = [];
export function registerGroups(sfxGroups: string[], vfxGroups: string[], screenRows: ScreenRow[]): void {
SFX_GROUPS = sfxGroups;
const merged: string[] = [];
for (const r of screenRows) if (merged.indexOf(r.category) < 0) merged.push(r.category);
for (const g of vfxGroups) if (merged.indexOf(g) < 0) merged.push(g);
VFX_GROUPS = merged;
SCREEN_ROWS = screenRows;
EXTRA_CAT_KEYS = {};
for (const r of screenRows) EXTRA_CAT_KEYS[r.category] = r.catKey;
}
function groupTextKey(tab: Tab, i: number): string {
if (i === 0) return T.chipAll;
const list = tab === "sfx" ? SFX_GROUPS : VFX_GROUPS;
const name = list[i - 1];
if (name === undefined) return T.chipAll;
const extra = EXTRA_CAT_KEYS[name];
if (extra !== undefined) return extra;
for (const e of CATEGORY_TEXT) if (e.text === name) return e.key;
return T.chipAll;
}
function groupName(tab: Tab, i: number): string {
if (i === 0) return "*";
const list = tab === "sfx" ? SFX_GROUPS : VFX_GROUPS;
return list[i - 1] ?? "";
}
function allRows(tab: Tab): Row[] {
const out: Row[] = [];
if (tab === "sfx") {
for (const e of SFX_CATALOG) out.push({ type: "sfx", entry: e });
return out;
}
for (const e of VFX_CATALOG) out.push({ type: "spawn", entry: e });
for (const r of SCREEN_ROWS) out.push(r);
return out;
}
export function favRows(ui: PlayerUi, f: FilterState): Row[] {
const q = f.query.trim().toLowerCase();
const out: Row[] = [];
for (const key of ui.favourites) {
const tpl = key.startsWith("tpl") ? findTemplate(ui.tester, key) : undefined;
const r: Row | undefined = tpl !== undefined ? { type: "tpl", tpl: tpl } : findRow(key);
if (r === undefined || r.type === "screen") continue;
if (!matches(r, "vfx", f)) continue;
if (!matchesQuery(r, q)) continue;
out.push(r);
}
return out;
}
export function isFavourite(ui: PlayerUi, key: string): boolean {
return ui.favourites.indexOf(key) >= 0;
}
export function visibleList(ui: PlayerUi): Row[] {
if (isTesterTab(ui.tab)) return [];
const f = filtersOf(ui);
return ui.tab === "fav" ? favRows(ui, f) : listFor(ui.tab, ui.group, f);
}
export function listFor(tab: Tab, group: number, f: FilterState): Row[] {
const q = f.query.trim().toLowerCase();
const source = q === "" ? groupRows(tab, group) : allRows(tab);
const out: Row[] = [];
for (const r of source) {
if (!matches(r, tab, f)) continue;
if (!matchesQuery(r, q)) continue;
out.push(r);
}
return out;
}
function groupRows(tab: Tab, group: number): Row[] {
const name = groupName(tab, group);
const out: Row[] = [];
for (const r of allRows(tab)) if (name === "*" || rowCategory(r) === name) out.push(r);
return out;
}
export function totalCount(tab: Tab): number {
return allRows(tab).length;
}
export function groupCounts(tab: Tab): number[] {
const n = tab === "sfx" ? SFX_GROUPS.length : VFX_GROUPS.length;
const out: number[] = [];
for (let i = 0; i < n + 1; i++) out.push(groupRows(tab, i).length);
return out;
}
export function perPage(): number {
return GRID.rows;
}
export function pageCount(n: number): number {
return Math.max(1, Math.ceil(n / perPage()));
}
export function pageSlice<T>(list: T[], page: number): T[] {
const out: T[] = [];
const start = page * perPage();
for (let i = start; i < start + perPage() && i < list.length; i++) out.push(list[i]);
return out;
}
export function findRow(key: string): Row | undefined {
if (key.startsWith("screen:")) {
const id = key.slice(7);
for (const r of SCREEN_ROWS) if (r.id === id) return r;
return undefined;
}
for (const e of SFX_CATALOG) if (e.name === key) return { type: "sfx", entry: e };
for (const e of VFX_CATALOG) if (e.name === key) return { type: "spawn", entry: e };
return undefined;
}
const DISPATCH: { onAction?: (ui: PlayerUi, action: string) => void } = {};
export function setActionHandler(fn: (ui: PlayerUi, action: string) => void): void {
DISPATCH.onAction = fn;
}
interface Handle {
el: UI.Element;
kind: "container" | "text" | "textbutton";
labelled: boolean;
lit: boolean;
resolve?: () => string;
}
export interface PlayerUi {
player: mod.Player;
pid: number;
tab: Tab;
open: boolean;
group: number;
railPage: number;
page: number;
selectedKey: string;
armedKey: string;
favourites: string[];
scale: number;
amp: number;
rng: number;
query: string;
searchOpen: boolean;
kbPage: number;
spawnedCount: number;
fDim: string;
fKind: string;
fVfx: string;
tester: TesterState;
root: UIContainer | undefined;
nodes: Record<string, Handle>;
keyAct: string[];
pfxAct: string[];
rowKeys: string[];
chipAct: string[];
qrOpen: boolean;
qrParts: string[];
qrPart: number;
qr: UIQRCode | undefined;
qrShown: number;
}
export function prefixesFor(tab: Tab): readonly PrefixEntry[] {
return tab === "sfx" ? SFX_PREFIXES : VFX_PREFIXES;
}
export function filtersOf(ui: PlayerUi): FilterState {
return { query: ui.query, dim: ui.fDim, kind: ui.fKind, vfx: ui.fVfx };
}
function sfxRowFields(ui: PlayerUi, e: SfxEntry, selected: boolean, armed: boolean): Scope {
const isLoop = e.kind === "loop";
const is3d = e.dim === "3d";
const b1c = is3d ? P.blue : P.amber;
const b2c = isLoop ? P.green : P.grey;
return {
bg: selected ? P.rowSel : P.row,
name: K(e.key),
nameColor: selected ? P.ink : P.inkDim,
category: K(e.catKey),
favLabel: K(isFavourite(ui, e.name) ? T.favRemove : T.favAdd),
favColor: isFavourite(ui, e.name) ? P.amber : P.inkDim,
favBg: isFavourite(ui, e.name) ? P.rowSel : P.row,
stopLabel: K(T.stop),
stopColor: P.inkDim,
stopBg: P.panel,
playLabel: K(T.play),
playColor: "#FFFFFF",
playBg: isLoop ? P.green : P.blue,
actColor: "#FFFFFF",
actBg: is3d ? P.blue : P.amber,
b1: ui.tab === "fav" ? K(T.kindSfx) : K(is3d ? T.chip3d : T.chip2d),
b1Color: ui.tab === "fav" ? P.blue : b1c,
b1Bg: ui.tab === "fav" ? P.blue : b1c,
b2: ui.tab === "fav" ? mod.Message(T.logEmpty) : K(isLoop ? T.chipLoop : e.lengthKey !== "" ? e.lengthKey : T.chipOne),
b2Color: ui.tab === "fav" ? P.row : b2c,
b2Bg: ui.tab === "fav" ? P.row : b2c,
selLabel: K(armed ? T.armedWord : T.select),
selColor: armed ? "#FFFFFF" : P.ink,
selBg: armed ? P.green : selected ? P.rowSel : P.row,
};
}
function tplRowFields(t: Template, selected: boolean): Scope {
const badge = t.kind === "music" ? P.green : P.violet;
return {
bg: selected ? P.rowSel : P.row,
name: K(templateNameKey(t)),
nameColor: selected ? P.ink : P.inkDim,
category: templateLine(t),
favLabel: K(T.favRemove),
favColor: P.amber,
favBg: P.rowSel,
stopLabel: K(T.stop),
stopColor: P.inkDim,
stopBg: P.panel,
playLabel: K(T.play),
playColor: "#FFFFFF",
playBg: badge,
actColor: "#FFFFFF",
actBg: badge,
b1: K(templateKindKey(t)),
b1Color: badge,
b1Bg: badge,
b2: mod.Message(T.logEmpty),
b2Color: P.row,
b2Bg: P.row,
selLabel: K(T.tplOpen),
selColor: P.ink,
selBg: P.row,
};
}
function vfxRowFields(ui: PlayerUi, r: Row, selected: boolean, armed: boolean, scale: number): Scope {
if (r.type === "sfx") return sfxRowFields(ui, r.entry, selected, armed);
if (r.type === "tpl") return tplRowFields(r.tpl, selected);
const world = r.type === "spawn";
const b1c = world ? P.violet : P.green;
const b2c = world ? P.blue : P.amber;
const saved = isFavourite(ui, rowKey(r));
const onShortlist = ui.tab === "fav";
const kindColor = P.violet;
return {
bg: selected ? P.rowSel : P.row,
name: K(rowTextKey(r)),
nameColor: selected ? P.ink : P.inkDim,
category: K(rowCatTextKey(r)),
favLabel: K(saved ? T.favRemove : T.favAdd),
favColor: saved ? P.amber : P.inkDim,
favBg: saved ? P.rowSel : P.row,
stopLabel: K(T.stop),
stopColor: P.inkDim,
stopBg: P.panel,
playLabel: K(T.play),
playColor: "#FFFFFF",
playBg: b1c,
actGlyph: K(world ? T.spawnGlyph : T.effectGlyph),
actColor: "#FFFFFF",
actBg: b1c,
b1: onShortlist ? K(T.kindVfx) : world ? mod.Message(TPL.scaleOf, scale) : K(T.chipPlayer),
b1Color: onShortlist ? kindColor : b1c,
b1Bg: onShortlist ? kindColor : b1c,
b2: onShortlist ? mod.Message(T.logEmpty) : K(world ? T.chipWorld : T.chipOne),
b2Color: onShortlist ? P.row : b2c,
b2Bg: onShortlist ? P.row : b2c,
selLabel: K(armed ? T.armedWord : T.select),
selColor: armed ? "#FFFFFF" : P.ink,
selBg: armed ? P.green : selected ? P.rowSel : P.row,
};
}
export function railFields(tab: Tab, row: number, count: number, active: boolean): Scope {
const label = groupTextKey(tab, row);
return {
label: mod.Message(TPL.gap2, label, count),
color: active ? "#FFFFFF" : P.inkDim,
bg: active ? P.hot : P.line,
};
}
function activeFilterLabel(ui: PlayerUi): mod.Message {
const bits: string[] = [];
if (ui.fDim !== "") bits.push(ui.fDim === "3d" ? T.chip3d : T.chip2d);
if (ui.fKind !== "") bits.push(ui.fKind === "loop" ? T.chipLoop : T.chipOne);
if (ui.fVfx !== "") bits.push(ui.fVfx === "world" ? T.chipWorld : T.chipPlayer);
if (bits.length === 0) return mod.Message(TPL.filters0);
if (bits.length === 1) return mod.Message(TPL.filters1, bits[0]);
if (bits.length === 2) return mod.Message(TPL.filters2, bits[0], bits[1]);
return mod.Message(TPL.filters3, bits[0], bits[1], bits[2]);
}
export function chromeFields(ui: PlayerUi, shown: number, listed: number, total: number): Scope {
const sfx = ui.tab === "sfx";
const onFav = ui.tab === "fav";
const tester = isTesterTab(ui.tab);
const debug = debugEnabled();
const armedRow = ui.armedKey === "" ? undefined : findRow(ui.armedKey);
const armedTextKey = armedRow === undefined ? T.nothingArmed : rowTextKey(armedRow);
return {
menuOpen: ui.open && !ui.qrOpen ? "1" : "0",
qrOn: ui.open && ui.qrOpen ? "1" : "0",
qrNav: ui.qrParts.length > 1 ? "1" : "0",
qrPart: mod.Message(TPL.qrPartOf, ui.qrPart + 1, Math.max(1, ui.qrParts.length)),
armedOn: onFav ? "0" : "1",
favHead: onFav ? "1" : "0",
qrBtnColor: ui.favourites.length > 0 ? "#FFFFFF" : P.faint,
qrBtnBg: ui.favourites.length > 0 ? P.blue : P.panel,
sfxParams: sfx ? "1" : "0",
vfxParams: sfx ? "0" : "1",
searchOpen: ui.searchOpen ? "1" : "0",
searchBg: ui.searchOpen ? P.green : P.line,
tabSfxColor: sfx ? "#FFFFFF" : P.inkDim,
tabSfxBg: sfx ? P.hot : P.line,
tabVfxColor: ui.tab === "vfx" ? "#FFFFFF" : P.inkDim,
tabVfxBg: ui.tab === "vfx" ? P.hot : P.line,
tabFavColor: onFav ? "#FFFFFF" : P.inkDim,
tabFavBg: onFav ? P.hot : P.line,
tabMusicColor: ui.tab === "music" ? "#FFFFFF" : P.inkDim,
tabMusicBg: ui.tab === "music" ? P.hot : P.line,
tabRadioColor: ui.tab === "radio" ? "#FFFFFF" : P.inkDim,
tabRadioBg: ui.tab === "radio" ? P.hot : P.line,
browserOn: tester ? "0" : "1",
testerOn: tester ? "1" : "0",
...testerFields(ui.tab === "radio" ? "radio" : "music", ui.tester),
selectLabel: onFav ? K(ui.favourites.length === 0 ? T.noFavourites : T.exportFavs) : K(ui.selectedKey === "" ? T.selectAnItem : ui.armedKey === ui.selectedKey ? T.selected : T.select),
selectColor: onFav ? P.ink : "#FFFFFF",
selectBg: onFav ? P.panel : ui.selectedKey === "" ? P.row : ui.armedKey === ui.selectedKey ? P.green : P.blue,
debugLabel: K(debug ? T.debugOn : T.debugOff),
debugColor: debug ? P.green : P.inkDim,
debugBg: debug ? P.panel : P.row,
headBadge: K(sfx ? T.spatiality : T.scaleWord),
armed: ui.armedKey === "" ? K(T.nothingArmed) : mod.Message(TPL.armedOf, armedTextKey),
armedColor: ui.armedKey === "" ? P.faint : P.green,
railSummary: shown === total ? mod.Message(TPL.itemsOf, total) : mod.Message(TPL.matchOf, shown, total),
page: mod.Message(TPL.pageOf, ui.page + 1, pageCount(shown)),
amp: mod.Message(TPL.num1, ui.amp),
rng: mod.Message(TPL.num1, Math.round(ui.rng)),
scale: mod.Message(TPL.scaleOf, ui.scale),
spawned: mod.Message(TPL.spawnedOf, ui.spawnedCount),
queryText: K(T.typeToSearch),
queryEmpty: ui.query === "" ? "1" : "0",
queryCount: mod.Message(TPL.matchOf2, shown, total),
filterSummary: activeFilterLabel(ui),
hint: hintFor(ui),
};
void listed;
}
export function findLabel(key: string): string {
const r = findRow(key);
return r === undefined ? key : rowDisplay(r);
}
function hintFor(ui: PlayerUi): mod.Message {
if (ui.searchOpen) return mod.Message(T.hintSearch);
if (!ui.open) return mod.Message(T.hintClosed);
if (ui.tab === "music") return mod.Message(T.hintMusic);
if (ui.tab === "radio") return mod.Message(T.hintRadio);
if (ui.tab === "vfx") {
return mod.Message(ui.selectedKey === "" ? T.hintVfxPick : T.hintVfxArmed);
}
return mod.Message(ui.selectedKey === "" ? T.hintSfxPick : T.hintSfxArmed);
}
function ensureWidget(
ui: PlayerUi,
n: WidgetNode,
action: string,
parent: UI.Parent,
fields: Fields,
scope: string,
ox: number,
oy: number,
visible: boolean,
resolveAction?: () => string
): Handle {
const x = ox + n.x;
const y = oy + n.y;
const h = n.h ?? 0;
let width = n.w ?? 0;
if (n.wScale !== undefined) width = width * Number(prop(n, n.wScale, fields, scope) ?? 0);
if (width < 0) width = 0;
const bgHexRaw = propStr(n, "bg", fields, scope);
const bgHex = bgHexRaw ?? "#000000";
const bgAlpha = Number(prop(n, "bgAlpha", fields, scope) ?? 1);
const bgFill = uiFill(propStr(n, "fill", fields, scope));
const tSize = Number(prop(n, "textSize", fields, scope) ?? 7);
const tColorHex = propStr(n, n.k === "text" ? "color" : "textColor", fields, scope) ?? "#FFFFFF";
const tAlpha = Number(prop(n, "textAlpha", fields, scope) ?? 1);
const tAnchor = uiAnchor(propStr(n, "align", fields, scope));
const rawText = prop(n, "text", fields, scope);
const label = rawText === undefined || rawText === "" ? mod.Message(T.logEmpty) : msgFor(rawText);
const existing = ui.nodes[action];
if (existing !== undefined) {
existing.el.visible = visible;
setPosition(existing.el, x, y);
setSize(existing.el, width, h);
if (existing.kind === "container") {
existing.el.bgColor = rgb(bgHex);
existing.el.bgAlpha = bgAlpha;
existing.el.bgFill = bgFill;
} else if (existing.kind === "text") {
const t = existing.el as UIText;
t.bgColor = rgb(bgHex);
t.bgAlpha = bgAlpha;
t.bgFill = bgFill;
t.label = label;
t.textSize = tSize;
t.textColor = rgb(tColorHex);
t.textAlpha = tAlpha;
t.textAnchor = tAnchor;
} else {
const b = existing.el as UITextButton;
b.bgColor = rgb(bgHex);
b.bgAlpha = bgAlpha;
b.bgFill = bgFill;
b.label = label;
b.textSize = tSize;
b.textColor = existing.lit ? rgb("#FFFFFF") : rgb(tColorHex);
b.textAlpha = tAlpha;
b.textAnchor = tAnchor;
const pal = buttonPalette(bgHex);
b.baseColor = existing.lit ? pal.hover : pal.base;
b.baseAlpha = bgAlpha;
b.disabledColor = pal.disabled;
b.disabledAlpha = bgAlpha;
b.pressedColor = pal.pressed;
b.pressedAlpha = bgAlpha;
b.focusedColor = pal.hover;
b.focusedAlpha = bgAlpha;
}
existing.labelled = true;
existing.resolve = resolveAction;
return existing;
}
if (createBudget <= 0) throw BUDGET_SPENT;
createBudget--;
createdThisPass++;
const base = {
parent: parent,
position: { x: x, y: y },
size: { width: width, height: h },
anchor: UI.Anchor.TopLeft,
visible: visible,
bgColor: rgb(bgHex),
bgAlpha: bgAlpha,
bgFill: bgFill,
depth: UI.Depth.AboveGameUI,
receiver: ui.player,
};
let handle: Handle;
if (n.k === "container") {
handle = { el: new UIContainer(base), kind: "container", labelled: false, lit: false };
} else if (n.k === "text") {
handle = {
el: new UIText({
...base,
label: label,
textSize: tSize,
textColor: rgb(tColorHex),
textAlpha: tAlpha,
textAnchor: tAnchor,
}),
kind: "text",
labelled: true,
lit: false,
};
} else {
const pal = buttonPalette(bgHex);
const btn = new UITextButton({
...base,
label: label,
textSize: tSize,
textColor: rgb(tColorHex),
textAlpha: tAlpha,
textAnchor: tAnchor,
enabled: n.enabled !== false,
baseColor: pal.base,
baseAlpha: bgAlpha,
disabledColor: pal.disabled,
disabledAlpha: bgAlpha,
pressedColor: pal.pressed,
pressedAlpha: bgAlpha,
focusedColor: pal.hover,
focusedAlpha: bgAlpha,
onClickUp: () => {
handle.lit = false;
btn.baseColor = pal.base;
btn.textColor = rgb(tColorHex);
const a = handle.resolve !== undefined ? handle.resolve() : action;
if (a !== "" && DISPATCH.onAction !== undefined) DISPATCH.onAction(ui, a);
},
onClickDown: () => {
handle.lit = true;
btn.baseColor = pal.hover;
btn.textColor = rgb("#FFFFFF");
},
onFocusIn: () => {
log("focus in: " + action);
handle.lit = true;
btn.baseColor = pal.hover;
btn.textColor = rgb("#FFFFFF");
},
onFocusOut: () => {
log("focus out: " + action);
handle.lit = false;
btn.baseColor = pal.base;
btn.textColor = rgb(tColorHex);
},
});
handle = {
el: btn,
kind: "textbutton",
labelled: true,
lit: false,
resolve: resolveAction,
};
}
ui.nodes[action] = handle;
return handle;
}
function asParent(h: Handle): UI.Parent {
return h.el as unknown as UI.Parent;
}
function setPosition(el: UI.Element, x: number, y: number): void {
el.x = x;
el.y = y;
}
function setSize(el: UI.Element, w: number, h: number): void {
el.width = w;
el.height = h;
}
function buildNodes(
ui: PlayerUi,
nodes: readonly SceneNode[],
parent: UI.Parent,
fields: Fields,
scope: string,
ox: number,
oy: number,
prefix: string,
inheritedVisible: boolean
): void {
const groupVisible: Record<string, boolean> = {};
const groupOrigin: Record<string, { x: number; y: number }> = {};
for (let i = 0; i < nodes.length; i++) {
const n = nodes[i];
if (n.k === "group") {
const gid = n.id ?? "g" + i;
if (n.parent !== undefined && groupVisible[n.parent] === false) {
groupVisible[gid] = false;
groupOrigin[gid] = { x: 0, y: 0 };
continue;
}
const bound = prop(n, "visible", fields, scope);
groupVisible[gid] = bound !== undefined ? bound !== "0" && bound !== "false" : n.visible !== false;
groupOrigin[gid] = { x: n.x, y: n.y };
continue;
}
let gx = 0;
let gy = 0;
let visible = inheritedVisible;
const owner = n.parent;
if (owner !== undefined) {
if (groupVisible[owner] === false) visible = false;
const o = groupOrigin[owner];
if (o !== undefined) {
gx = o.x;
gy = o.y;
}
}
const tag = n.id !== undefined && n.k !== "repeat" && n.id !== "" ? n.id : "x" + i;
const action = prefix + tag;
if (n.k === "repeat") {
const tpl = n.template;
if (tpl === null || tpl === undefined) continue;
const count = n.count ?? 0;
const cols = n.cols ?? 0;
const gap = n.gap ?? 0;
const gapX = n.gapX ?? gap;
const gapY = n.gapY ?? gap;
const tw = tpl.w ?? 0;
const th = tpl.h ?? 0;
for (let j = 0; j < count; j++) {
const cx = cols > 0 ? (j % cols) * (tw + gapX) : j * (tw + gap);
const cy = cols > 0 ? Math.floor(j / cols) * (th + gapY) : 0;
if (!visible && ui.nodes[action + "_r" + j] === undefined) continue;
ensureWidget(ui, { ...tpl, x: tpl.x + cx, y: tpl.y + cy }, action + "_r" + j, parent, fields, scope, ox + gx + n.x, oy + gy + n.y, visible);
}
continue;
}
if (!visible && ui.nodes[action] === undefined) continue;
ensureWidget(ui, n, action, parent, fields, scope, ox + gx, oy + gy, visible);
}
}
export function initUI(ui: PlayerUi): void {
if (ui.root !== undefined) return;
ui.root = new UIContainer({
position: { x: 0, y: 0 },
size: { width: 1920, height: 1080 },
anchor: UI.Anchor.TopLeft,
receiver: ui.player,
visible: ui.open,
uiInputModeWhenVisible: true,
});
const rows: string[] = [];
for (let i = 0; i < GRID.rows; i++) rows.push("");
ui.rowKeys = rows;
const chipAct: string[] = [];
for (let i = 0; i < MAX_CHIPS; i++) chipAct.push("");
ui.chipAct = chipAct;
const keyAct: string[] = [];
for (let i = 0; i < KEY_SLOTS; i++) keyAct.push("");
ui.keyAct = keyAct;
const pfxAct: string[] = [];
for (let i = 0; i < PFX_SLOTS; i++) pfxAct.push("");
ui.pfxAct = pfxAct;
}
function root(ui: PlayerUi): UI.Parent {
return ui.root ?? UI.ROOT_NODE;
}
export function destroyUI(ui: PlayerUi): void {
if (ui.qr !== undefined) ui.qr.delete();
ui.qr = undefined;
if (ui.root !== undefined) ui.root.delete();
ui.root = undefined;
ui.nodes = {};
}
function chipAction(key: string, val: string): string {
if (val === "") return "fa";
if (key === "dim") return val === "3d" ? "fd3" : "fd2";
if (key === "kind") return val === "loop" ? "fl" : "fo";
if (key === "vfx") return val === "world" ? "fw" : "fp";
return "fa";
}
function chipIsActive(ui: PlayerUi, key: string, val: string): boolean {
if (key === "dim") return val === "" ? ui.fDim === "" : ui.fDim === val;
if (key === "kind") return val === "" ? ui.fKind === "" : ui.fKind === val;
if (key === "vfx") return val === "" ? ui.fVfx === "" : ui.fVfx === val;
return false;
}
function chipTextKey(c: { key: string; val: string }): string {
if (c.val === "") return T.chipAll;
if (c.key === "dim") return c.val === "3d" ? T.chip3d : T.chip2d;
if (c.key === "kind") return c.val === "loop" ? T.chipLoop : T.chipOne;
if (c.key === "vfx") return c.val === "world" ? T.chipWorld : T.chipPlayer;
return T.chipAll;
}
function bottomKey(action: string): string {
if (action === "spc") return T.space;
if (action === "bksp") return T.back;
if (action === "clr") return T.clear;
if (action === "done") return T.done;
return T.search;
}
const QUERY_CELL_W = 11;
const MAX_CHIPS = 5;
const KEY_CHARS: string[] = (() => {
const out: string[] = [];
for (const row of KEYBOARD.rows) for (const c of row) if (charKey(c) !== undefined) out.push(c);
return out;
})();
const KEY_SLOTS = KEY_CHARS.length;
const PFX_SLOTS = KEYBOARD.prefixGrid.max;
const BUDGET_SPENT = { budgetSpent: true };
let createBudget = Number.POSITIVE_INFINITY;
let createdThisPass = 0;
export interface BatchResult {
complete: boolean;
created: number;
}
export function renderBatch(ui: PlayerUi, spawnedCount: number, maxNew: number): BatchResult {
createBudget = maxNew;
createdThisPass = 0;
try {
render(ui, spawnedCount);
return { complete: true, created: createdThisPass };
} catch (e) {
if (e !== BUDGET_SPENT) throw e;
return { complete: false, created: createdThisPass };
} finally {
createBudget = Number.POSITIVE_INFINITY;
}
}
export function render(ui: PlayerUi, spawnedCount: number): void {
initUI(ui);
ui.spawnedCount = spawnedCount;
const onFav = ui.tab === "fav";
const tester = isTesterTab(ui.tab);
const list = visibleList(ui);
const total = tester ? 0 : onFav ? ui.favourites.length : totalCount(ui.tab);
const maxPage = pageCount(list.length) - 1;
if (ui.page > maxPage) ui.page = maxPage;
if (ui.page < 0) ui.page = 0;
const parent = root(ui);
const open = ui.open;
if (ui.root !== undefined) ui.root.visible = open;
const fields: Fields = { sh: P, f: chromeFields(ui, list.length, 0, total) };
buildNodes(ui, SCREEN, parent, fields, "f", 0, 0, "", open);
syncQr(ui, parent);
if (!open) return;
if (ui.qrOpen) {
hideBrowserWidgets(ui);
return;
}
if (tester) {
hideBrowserWidgets(ui);
return;
}
const chips = ui.tab === "sfx" ? FILTERS.sfx : FILTERS.vfx;
for (let i = 0; i < MAX_CHIPS; i++) {
const c = chips[i];
if (c === undefined || onFav) {
const spare = ui.nodes["chip" + i];
if (spare !== undefined) spare.el.visible = false;
ui.chipAct[i] = "";
continue;
}
const active = chipIsActive(ui, c.key, c.val);
ui.chipAct[i] = chipAction(c.key, c.val);
const label = K(chipTextKey(c));
const bg = active ? P.blue : P.row;
const fg = active ? "#FFFFFF" : P.inkDim;
const cf: Fields = { sh: P, f: { text: label, textColor: fg, bg: bg } };
ensureWidget(
ui,
{ k: "textbutton", x: FILTERS.chipX + i * (FILTERS.chipW + FILTERS.gap), y: FILTERS.chipY, w: FILTERS.chipW, h: FILTERS.chipH, fill: "Solid", bg: bg, bgAlpha: 1, text: label, textSize: 13, textColor: fg, align: "Center" },
"chip" + i,
parent,
cf,
"f",
0,
0,
true,
() => ui.chipAct[i]
);
}
{
const sf: Fields = {
sh: P,
f: {
text: K(ui.searchOpen ? T.keyboardOpen : T.search),
textColor: ui.searchOpen ? "#FFFFFF" : P.ink,
bg: ui.searchOpen ? P.green : P.panel,
},
};
ensureWidget(ui, { k: "textbutton", x: FILTERS.searchX, y: FILTERS.searchY, w: FILTERS.searchW, h: FILTERS.searchH, fill: "Solid", bg: ui.searchOpen ? P.green : P.panel, bgAlpha: 1, text: K(ui.searchOpen ? T.keyboardOpen : T.search), textSize: 14, textColor: ui.searchOpen ? "#FFFFFF" : P.ink, align: "Center" }, "btnSearch", parent, sf, "f", 0, 0, true);
}
if (onFav) {
for (let slot = 0; slot < RAIL.visibleRows - 1; slot++) {
const spare = ui.nodes["railBtn" + slot];
if (spare !== undefined) spare.el.visible = false;
}
for (const id of ["railAll", "btnRailPrev", "btnRailNext", "railPage"]) {
const h = ui.nodes[id];
if (h !== undefined) h.el.visible = false;
}
} else {
const counts = groupCounts(ui.tab);
const groupTotal = counts.length - 1;
const groupRows = RAIL.visibleRows - 1;
const railPages = Math.max(1, Math.ceil(groupTotal / groupRows));
if (ui.railPage >= railPages) ui.railPage = railPages - 1;
if (ui.railPage < 0) ui.railPage = 0;
const railX = RAIL.x + RAIL.rowPadX;
ensureWidget(ui, RAIL_ROW, "railAll", parent, { sh: P, rail: railFields(ui.tab, 0, counts[0], ui.group === 0) }, "rail", railX, RAIL.rowsY, true, () => "rail0");
const railFirst = ui.railPage * groupRows;
for (let slot = 0; slot < groupRows; slot++) {
const gi = railFirst + slot + 1;
if (gi > groupTotal) {
const spare = ui.nodes["railBtn" + slot];
if (spare !== undefined) spare.el.visible = false;
continue;
}
const active = ui.group === gi;
const rf: Fields = { sh: P, rail: railFields(ui.tab, gi, counts[gi], active) };
const action = "rail" + gi;
ensureWidget(ui, RAIL_ROW, "railBtn" + slot, parent, rf, "rail", railX, RAIL.rowsY + (slot + 1) * RAIL.rowH, true, () => action);
}
for (const n of RAIL_PAGER) {
if (n.k !== "textbutton") continue;
const nf: Fields = { sh: P, f: { text: n.text === undefined ? mod.Message(T.logEmpty) : S(n.text), textColor: "#FFFFFF", bg: P.orangeDim } };
ensureWidget(ui, n, n.id ?? "railPagerBtn", parent, nf, "f", 0, 0, open);
}
{
const rp = mod.Message(TPL.railPageOf, ui.railPage + 1, railPages);
const w = RAIL.rowW - RAIL.pagerW * 2 - 8;
ensureWidget(
ui,
{ k: "text", x: RAIL.x + RAIL.rowPadX + RAIL.pagerW + 4, y: RAIL.pagerY, w: w, h: RAIL.pagerH, text: rp, textSize: 11, textColor: P.muted, align: "Center" },
"railPage",
parent,
{ sh: P, f: { text: rp, textColor: P.muted } },
"f",
0,
0,
true
);
}
}
const page = pageSlice(list, ui.page);
for (let i = 0; i < GRID.rows; i++) {
const item = page[i];
if (item === undefined) {
ui.rowKeys[i] = "";
const box = ui.nodes["row" + i];
if (box !== undefined) box.el.visible = false;
continue;
}
const key = rowKey(item);
ui.rowKeys[i] = key;
const rowY = GRID.originY + i * GRID.rowH;
const box = ensureWidget(
ui,
{ k: "container", x: GRID.originX, y: rowY, w: GRID.rowW, h: GRID.rowH, fill: "None" },
"row" + i,
parent,
{ sh: P },
"f",
0,
0,
true
);
const selected = key === ui.selectedKey;
const armed = key === ui.armedKey;
const rf: Fields = { sh: P, r: vfxRowFields(ui, item, selected, armed, ui.scale) };
buildNodes(ui, ROW, asParent(box), rf, "r", 0, 0, "r" + i + "_", true);
}
if (ui.searchOpen) buildKeyboard(ui, list.length, total);
else hideKeyboard(ui);
}
function buildQueryBar(ui: PlayerUi, parent: UI.Parent, kb: typeof KEYBOARD, shown: number, total: number): void {
const q = ui.query;
const qx = 16;
const qy = kb.queryY - kb.y;
const countW = 380;
const fieldW = kb.w - countW - 40;
const field = ensureWidget(
ui,
{ k: "container", x: qx - 8, y: qy - 6, w: fieldW + 16, h: kb.queryH + 12, fill: "Solid", bg: P.line, bgAlpha: 1 },
"kbField",
parent,
{ sh: P },
"f",
0,
0,
true
);
field.el.visible = true;
const hint = K(ui.kbPage === 1 ? T.tapPrefix : T.typeToSearchDot);
const hintH = ensureWidget(ui, { k: "text", x: qx, y: qy, w: fieldW, h: kb.queryH, text: hint, textSize: 20, textColor: P.faint, align: "Left" }, "kbHint", parent, { sh: P, f: { text: hint, textColor: P.faint } }, "f", 0, 0, q === "");
hintH.el.visible = q === "";
const cm = mod.Message(TPL.matchOf2, shown, total);
ensureWidget(ui, { k: "text", x: kb.w - countW - 16, y: qy, w: countW, h: kb.queryH, text: cm, textSize: 14, textColor: P.muted, align: "Right" }, "kbCount", parent, { sh: P, f: { text: cm, textColor: P.muted } }, "f", 0, 0, true);
for (let i = 0; i < MAX_QUERY; i++) {
const ch = q[i];
const key = ch === undefined ? undefined : charKey(ch);
const h = ensureWidget(
ui,
{ k: "text", x: qx + i * QUERY_CELL_W, y: qy, w: QUERY_CELL_W, h: kb.queryH, text: key === undefined ? mod.Message(T.logEmpty) : mod.Message(key), textSize: 20, textColor: P.ink, align: "Center" },
"kbq" + i,
parent,
{ sh: P, f: { text: key === undefined ? mod.Message(T.logEmpty) : mod.Message(key), textColor: P.ink } },
"f",
0,
0,
key !== undefined
);
h.el.visible = key !== undefined;
}
const cur = ensureWidget(ui, { k: "text", x: qx + q.length * QUERY_CELL_W, y: qy, w: QUERY_CELL_W, h: kb.queryH, text: K(T.charCursor), textSize: 20, textColor: P.green, align: "Center" }, "kbcur", parent, { sh: P, f: { text: K(T.charCursor), textColor: P.green } }, "f", 0, 0, true);
cur.el.visible = q !== "";
}
function buildKeyboard(ui: PlayerUi, shown: number, total: number): void {
const kb = KEYBOARD;
const parent = root(ui);
const box = ensureWidget(ui, { k: "container", x: kb.x, y: kb.y, w: kb.w, h: kb.h, fill: "Solid", bg: P.shell, bgAlpha: 1 }, "kbRoot", parent, { sh: P }, "f", 0, 0, true);
const kbParent = asParent(box);
buildQueryBar(ui, kbParent, kb, shown, total);
if (ui.kbPage === 1) {
hideSlots(ui, "key", KEY_SLOTS);
const pg = kb.prefixGrid;
const all = prefixesFor(ui.tab);
const n = all.length > pg.max ? pg.max : all.length;
for (let i = 0; i < pg.max; i++) {
const e = all[i];
if (e === undefined || i >= n) {
const spare = ui.nodes["pfx" + i];
if (spare !== undefined) spare.el.visible = false;
continue;
}
const col = i % pg.cols;
const row = Math.floor(i / pg.cols);
if (row >= pg.rows) continue;
ui.pfxAct[i] = "pfx_" + e.token;
const tile = i;
ensureWidget(
ui,
{
k: "textbutton",
x: pg.x0 - kb.x + col * (pg.w + pg.gap),
y: pg.rowY[row] - kb.y,
w: pg.w,
h: pg.h,
fill: "Solid",
bg: P.hairline,
bgAlpha: 1,
text: K(e.key),
textSize: 12,
textColor: P.ink,
align: "Center",
},
"pfx" + i,
kbParent,
{ sh: P, f: { text: K(e.key), textColor: P.ink, bg: P.hairline } },
"f",
0,
0,
true,
() => ui.pfxAct[tile]
);
}
} else {
hideSlots(ui, "pfx", PFX_SLOTS);
for (let r = 0; r < kb.rows.length; r++) {
const chars = kb.rows[r];
for (let c = 0; c < chars.length; c++) {
const ch = chars[c];
const ck = charKey(ch);
if (ck === undefined) continue;
const slot = KEY_CHARS.indexOf(ch);
if (slot < 0) continue;
ui.keyAct[slot] = "key_" + ch;
const cm = mod.Message(ck);
ensureWidget(ui, { k: "textbutton", x: kb.x0 - kb.x + c * (kb.keyW + kb.gap), y: kb.rowY[r] - kb.y, w: kb.keyW, h: kb.keyH, fill: "Solid", bg: P.hairline, bgAlpha: 1, text: cm, textSize: 20, textColor: P.ink, align: "Center" }, "key" + slot, kbParent, { sh: P, f: { text: cm, textColor: P.ink, bg: P.hairline } }, "f", 0, 0, true, () => ui.keyAct[slot]);
}
}
}
let bx = kb.x0 - kb.x;
for (const b of kb.bottom) {
const isDone = b.action === "done";
const isPage = b.action === "page";
const label = K(isPage ? (ui.kbPage === 1 ? T.abcKeys : T.prefixes) : bottomKey(b.action));
const bg = isDone ? P.green : b.action === "clr" ? P.redDim : isPage ? P.violet : P.row;
ensureWidget(ui, { k: "textbutton", x: bx, y: kb.bottomY - kb.y, w: b.w, h: kb.bottomH, fill: "Solid", bg: bg, bgAlpha: 1, text: label, textSize: 17, textColor: isDone ? "#FFFFFF" : P.ink, align: "Center" }, b.action, kbParent, { sh: P, f: { text: label, textColor: isDone ? "#FFFFFF" : P.ink, bg: bg } }, "f", 0, 0, true);
bx += b.w + kb.gap;
}
}
UIQRCode.tickBudget = CONFIG.qrWidgetsPerTick;
const QR_SLOT = (() => {
for (const n of SCREEN) if (n.id === "qrSlot") return { x: n.x, y: n.y, size: Math.min(n.w ?? 0, n.h ?? 0) };
throw new Error("scene.json has no qrSlot");
})();
function syncQr(ui: PlayerUi, parent: UI.Parent): void {
const text = ui.open && ui.qrOpen ? ui.qrParts[ui.qrPart] : undefined;
if (ui.qr !== undefined && (text === undefined || ui.qrShown !== ui.qrPart)) {
ui.qr.delete();
ui.qr = undefined;
}
if (text === undefined || ui.qr !== undefined) return;
ui.qr = new UIQRCode({
data: text,
ecc: UIQRCode.ECC.Low,
position: { x: QR_SLOT.x, y: QR_SLOT.y },
size: { width: QR_SLOT.size, height: QR_SLOT.size },
anchor: UI.Anchor.TopLeft,
parent: parent,
margin: 4,
});
ui.qrShown = ui.qrPart;
}
function hideBrowserWidgets(ui: PlayerUi): void {
hideSlots(ui, "chip", MAX_CHIPS);
hideSlots(ui, "railBtn", RAIL.visibleRows - 1);
hideSlots(ui, "row", GRID.rows);
for (const id of ["btnSearch", "railAll", "btnRailPrev", "btnRailNext", "railPage"]) {
const h = ui.nodes[id];
if (h !== undefined) h.el.visible = false;
}
hideKeyboard(ui);
}
function hideSlots(ui: PlayerUi, prefix: string, max: number): void {
for (let i = 0; i < max; i++) {
const h = ui.nodes[prefix + i];
if (h !== undefined) h.el.visible = false;
}
}
function hideKeyboard(ui: PlayerUi): void {
const box = ui.nodes["kbRoot"];
if (box !== undefined) box.el.visible = false;
hideSlots(ui, "key", KEY_SLOTS);
hideSlots(ui, "pfx", PFX_SLOTS);
hideSlots(ui, "kbq", MAX_QUERY);
for (const a of ["kbHint", "kbCount", "kbcur"]) {
const h = ui.nodes[a];
if (h !== undefined) h.el.visible = false;
}
}
// --- SOURCE: src\tester.ts ---
export type TesterTab = "music" | "radio";
function pkgNamed(name: string): MusicPackageSpec {
for (const p of MUSIC_PACKAGES) if (p.name === name) return p;
throw new Error("music package missing from music.gen.ts: " + name);
}
const MUSIC_TAB: readonly MusicPackageSpec[] = [pkgNamed("Core"), pkgNamed("BR"), pkgNamed("Gauntlet")];
const RADIO = pkgNamed("Radio");
const STARTUP = MUSIC_TAB[0];
const DEFAULT_EVENT: Readonly<Record<string, string>> = {
Core: "Core_LastPhaseBegin",
BR: "BR_InsertionJump",
Gauntlet: "Gauntlet_Deploy",
};
function defaultEventIndex(p: MusicPackageSpec): number {
const want = DEFAULT_EVENT[p.name];
for (let i = 0; i < p.events.length; i++) if (p.events[i].name === want) return i;
return 0;
}
function radioEvent(name: string): MusicEventSpec {
for (const e of RADIO.events) if (e.name === name) return e;
throw new Error("radio event missing from music.gen.ts: " + name);
}
const RADIO_PLAY = radioEvent("Radio_Play");
const RADIO_NEXT = radioEvent("Radio_NextQueuedTrack");
const RADIO_CLEAR = radioEvent("Radio_ClearQueue");
const RADIO_CHANNELS = [T.radioCh0, T.radioCh1, T.radioCh2, T.radioCh3, T.radioCh4, T.radioCh5, T.radioCh6];
const RADIO_BIOMES = [T.radioBiome0, T.radioBiome1, T.radioBiome2, T.radioBiome3, T.radioBiome4, T.radioBiome5, T.radioBiome6];
const RADIO_TRACKS = [17, 18, 10, 2, 0, 32, 15];
const RADIO_BIOME_TRACKS = [18, 16, 16, 19, 18, 2, 18];
function stationTracks(ch: number, biome: number): number | undefined {
return ch === 4 ? RADIO_BIOME_TRACKS[biome] : RADIO_TRACKS[ch];
}
let loaded: MusicPackageSpec | undefined;
let loadedAt = 0;
const held: (() => void)[] = [];
let flushScheduled = false;
function loading(): boolean {
return loaded !== undefined && Date.now() - loadedAt < CONFIG.musicLoadMs;
}
function whenLoaded(send: () => void): void {
if (!loading()) {
send();
return;
}
held.push(send);
if (flushScheduled) return;
flushScheduled = true;
const wait = CONFIG.musicLoadMs - (Date.now() - loadedAt);
log("music: holding calls " + wait + "ms while " + (loaded === undefined ? "?" : loaded.name) + " loads");
Timers.setTimeout(() => {
flushScheduled = false;
const run = held.splice(0, held.length);
for (const f of run) f();
}, wait);
}
export interface TesterState {
pkg: number;
evt: number[];
values: Record<string, number>;
last: mod.Message | undefined;
toAll: boolean;
queue: RadioPick[];
templates: Template[];
nextTemplate: number;
playing: string;
}
export interface RadioPick {
ch: number;
biome: number;
track: number;
}
export function newTesterState(): TesterState {
const values: Record<string, number> = {};
for (const p of MUSIC_PACKAGES) {
values[p.amp.name] = p.amp.def;
for (const x of p.params) values[x.name] = x.def;
}
return { pkg: 0, evt: MUSIC_TAB.map(defaultEventIndex), values: values, last: undefined, toAll: false, queue: [], templates: [], nextTemplate: 1, playing: "" };
}
export function loadStartupMusic(): void {
mod.LoadMusic(STARTUP.pkg);
loaded = STARTUP;
loadedAt = Date.now();
log("music: LoadMusic(" + STARTUP.name + ") at game-mode start");
mod.SetMusicParam(STARTUP.amp.param, STARTUP.amp.def);
log("music: SetMusicParam(" + STARTUP.amp.name + ", " + STARTUP.amp.def + ") for=everyone at game-mode start");
}
function current(tab: TesterTab, st: TesterState): MusicPackageSpec {
return tab === "radio" ? RADIO : MUSIC_TAB[st.pkg];
}
function round2(v: number): number {
return Math.round(v * 100) / 100;
}
function who(st: TesterState): string {
return st.toAll ? "everyone" : "me";
}
function load(st: TesterState, pkg: MusicPackageSpec, redraw: () => void): void {
if (loaded === pkg) {
log("music: " + pkg.name + " already loaded, LoadMusic not re-sent");
return;
}
if (loaded !== undefined) {
mod.UnloadMusic(loaded.pkg);
log("music: UnloadMusic(" + loaded.name + ")");
}
mod.LoadMusic(pkg.pkg);
loaded = pkg;
loadedAt = Date.now();
st.last = mod.Message(TPL.mtCallLoad, pkg.key);
log("music: LoadMusic(" + pkg.name + ")");
whenLoaded(redraw);
}
function ensureLoaded(st: TesterState, pkg: MusicPackageSpec, redraw: () => void): void {
if (loaded !== pkg) load(st, pkg, redraw);
}
function sendParam(player: mod.Player, st: TesterState, p: MusicParamSpec): void {
const v = st.values[p.name];
if (st.toAll) mod.SetMusicParam(p.param, v);
else mod.SetMusicParam(p.param, v, player);
st.last = mod.Message(TPL.mtCallParam, p.key, v);
log("music: SetMusicParam(" + p.name + ", " + v + ") for=" + who(st));
}
function sendEvent(player: mod.Player, st: TesterState, event: mod.MusicEvents, name: string, key: string): void {
if (st.toAll) mod.PlayMusic(event);
else mod.PlayMusic(event, player);
st.last = mod.Message(TPL.mtCallPlay, key);
const pkgNote = loaded === undefined ? "nothing loaded" : "loaded=" + loaded.name;
log("music: PlayMusic(" + name + ") for=" + who(st) + " " + pkgNote);
}
function maxOf(st: TesterState, p: MusicParamSpec): number {
if (!p.queues) return p.max;
const n = stationTracks(radioChannel(st), radioBiome(st));
return n === undefined ? p.max : Math.min(p.max, n - 1);
}
function clampQueueNumber(st: TesterState): void {
const q = queueParam(RADIO);
if (q !== undefined && st.values[q.name] > maxOf(st, q)) st.values[q.name] = maxOf(st, q);
}
function stepParam(player: mod.Player, st: TesterState, pkg: MusicPackageSpec, p: MusicParamSpec, dir: number): void {
const v = st.values[p.name] + dir * p.step;
st.values[p.name] = round2(Math.min(maxOf(st, p), Math.max(p.min, v)));
if (pkg === RADIO) clampQueueNumber(st);
if (p.queues || loaded !== pkg) return;
if (pkg !== RADIO && st.playing !== pkg.name) return;
whenLoaded(() => sendParam(player, st, p));
}
function queueParam(pkg: MusicPackageSpec): MusicParamSpec | undefined {
for (const p of pkg.params) if (p.queues) return p;
return undefined;
}
function radioChannel(st: TesterState): number {
return Math.round(st.values["Radio_Channel"] ?? 0);
}
function radioBiome(st: TesterState): number {
return Math.round(st.values["Radio_Biome"] ?? 0);
}
function stationKey(ch: number, biome: number): string {
return ch === 4 ? pickKey(RADIO_BIOMES, biome) : pickKey(RADIO_CHANNELS, ch);
}
function queueIsStale(st: TesterState): boolean {
const q = st.queue[st.queue.length - 1];
if (q === undefined) return false;
const ch = radioChannel(st);
return ch !== q.ch || (ch === 4 && radioBiome(st) !== q.biome);
}
function noteQueued(st: TesterState, q: MusicParamSpec): void {
const ch = radioChannel(st);
const biome = radioBiome(st);
const track = st.values[q.name];
st.queue.push({ ch: ch, biome: biome, track: track });
st.values[q.name] = track + 1 <= maxOf(st, q) ? track + 1 : q.min;
}
function sendQueue(player: mod.Player, st: TesterState, q: MusicParamSpec): void {
sendParam(player, st, paramNamed(RADIO, "Radio_Channel"));
sendParam(player, st, paramNamed(RADIO, "Radio_Biome"));
sendParam(player, st, q);
noteQueued(st, q);
}
function queueLine(st: TesterState): mod.Message {
const q = st.queue[st.queue.length - 1];
if (q === undefined) return mod.Message(T.mtQueueEmpty);
return mod.Message(TPL.mtQueueCount, st.queue.length, stationKey(q.ch, q.biome), q.track);
}
export interface MusicTemplate {
kind: "music";
n: number;
pkg: string;
evt: string;
values: Record<string, number>;
}
export interface RadioTemplate {
kind: "radio";
n: number;
values: Record<string, number>;
queue: RadioPick[];
}
export type Template = MusicTemplate | RadioTemplate;
function capture(tab: TesterTab, st: TesterState): Template {
const pkg = current(tab, st);
const values: Record<string, number> = {};
for (const p of pkg.params) if (!p.queues) values[p.name] = st.values[p.name];
values[pkg.amp.name] = st.values[pkg.amp.name];
if (tab === "radio") return { kind: "radio", n: 0, values: values, queue: st.queue.map((p) => ({ ch: p.ch, biome: p.biome, track: p.track })) };
return { kind: "music", n: 0, pkg: pkg.name, evt: pkg.events[st.evt[st.pkg]].name, values: values };
}
function signature(t: Template): string {
return JSON.stringify({ ...t, n: 0 });
}
export function saveTemplate(tab: TesterTab, st: TesterState): { tpl: Template; added: boolean } {
const t = capture(tab, st);
const sig = signature(t);
for (const old of st.templates) if (signature(old) === sig) return { tpl: old, added: false };
t.n = st.nextTemplate++;
st.templates.push(t);
log("template: saved " + templateExportLine(t));
return { tpl: t, added: true };
}
export function templateKey(t: Template): string {
return "tpl" + t.n;
}
export function findTemplate(st: TesterState, key: string): Template | undefined {
for (const t of st.templates) if (templateKey(t) === key) return t;
return undefined;
}
function musicPkg(t: MusicTemplate): MusicPackageSpec {
return pkgNamed(t.pkg);
}
function musicEvt(t: MusicTemplate): MusicEventSpec {
for (const e of musicPkg(t).events) if (e.name === t.evt) return e;
throw new Error("template event missing from music.gen.ts: " + t.evt);
}
function radioStation(t: RadioTemplate): { ch: number; biome: number } {
const first = t.queue[0];
if (first !== undefined) return first;
return { ch: Math.round(t.values["Radio_Channel"] ?? 0), biome: Math.round(t.values["Radio_Biome"] ?? 0) };
}
function stationText(ch: number, biome: number): string {
return (ch === 4 ? RADIO_TEXT.biomes[biome] : RADIO_TEXT.channels[ch]) ?? "?";
}
export function templateName(t: Template): string {
if (t.kind === "music") return t.evt;
const s = radioStation(t);
return stationText(s.ch, s.biome);
}
export function templateNameKey(t: Template): string {
if (t.kind === "music") return musicEvt(t).key;
const s = radioStation(t);
return stationKey(s.ch, s.biome);
}
export function templateLine(t: Template): mod.Message {
return t.kind === "music" ? mod.Message(TPL.tplMusicOf, t.n) : mod.Message(TPL.tplRadioOf, t.n, t.queue.length);
}
export function templateKindKey(t: Template): string {
return t.kind === "music" ? T.kindMusic : T.kindRadio;
}
function templatePkg(t: Template): MusicPackageSpec {
return t.kind === "music" ? musicPkg(t) : RADIO;
}
export function applyTemplate(st: TesterState, t: Template): TesterTab {
for (const name of Object.keys(t.values)) st.values[name] = t.values[name];
if (t.kind === "radio") return "radio";
const pkg = musicPkg(t);
st.pkg = MUSIC_TAB.indexOf(pkg);
st.evt[st.pkg] = pkg.events.indexOf(musicEvt(t));
return "music";
}
export function playTemplate(st: TesterState, player: mod.Player, t: Template, redraw: () => void): void {
const tab = applyTemplate(st, t);
const pkg = templatePkg(t);
ensureLoaded(st, pkg, redraw);
whenLoaded(() => {
if (t.kind === "radio") requeue(st, player, t);
sendPlay(tab, st, player);
redraw();
});
}
function requeue(st: TesterState, player: mod.Player, t: RadioTemplate): void {
const q = queueParam(RADIO);
const channel = paramNamed(RADIO, "Radio_Channel");
const biome = paramNamed(RADIO, "Radio_Biome");
if (q === undefined) return;
sendEvent(player, st, RADIO_CLEAR.event, RADIO_CLEAR.name, RADIO_CLEAR.key);
st.queue = [];
let ch = -1;
let bi = -1;
for (const pick of t.queue) {
if (pick.ch !== ch) {
st.values[channel.name] = pick.ch;
sendParam(player, st, channel);
ch = pick.ch;
}
if (pick.biome !== bi) {
st.values[biome.name] = pick.biome;
sendParam(player, st, biome);
bi = pick.biome;
}
st.values[q.name] = pick.track;
sendParam(player, st, q);
noteQueued(st, q);
}
for (const name of Object.keys(t.values)) st.values[name] = t.values[name];
}
function paramNamed(pkg: MusicPackageSpec, name: string): MusicParamSpec {
for (const p of pkg.params) if (p.name === name) return p;
throw new Error("param missing from music.gen.ts: " + name);
}
export function stopTemplate(st: TesterState, player: mod.Player, t: Template): void {
sendStop(st, player, templatePkg(t));
}
function sendStop(st: TesterState, player: mod.Player, pkg: MusicPackageSpec): void {
if (loaded !== pkg) return;
if (st.playing === pkg.name) st.playing = "";
whenLoaded(() => sendEvent(player, st, pkg.stop, pkg.name + "_Stop", pkg.stopKey));
}
export function removeTemplate(st: TesterState, key: string): void {
st.templates = st.templates.filter((t) => templateKey(t) !== key);
log("template: removed " + key);
}
export function templateExportLine(t: Template): string {
if (t.kind === "music") {
const pkg = musicPkg(t);
const params = pkg.params.map((p) => p.name + " " + t.values[p.name]).join(", ");
return "MUSIC TEMPLATE " + t.n + " | " + pkg.name + " | " + t.evt + " | " + (params === "" ? "no params" : params) + " | volume " + t.values[pkg.amp.name];
}
const ch = Math.round(t.values["Radio_Channel"] ?? 0);
const biome = Math.round(t.values["Radio_Biome"] ?? 0);
const own = (p: RadioPick) => p.ch === ch && (ch !== 4 || p.biome === biome);
const mixed = t.queue.some((p) => !own(p));
const queue = t.queue.length === 0 ? "queue empty" : "queue " + t.queue.map((p) => (mixed ? stationText(p.ch, p.biome) + " " : "") + "#" + p.track).join(", ");
return (
"RADIO TEMPLATE " + t.n +
" | channel " + ch + " " + stationText(ch, biome) +
" | " + queue +
" | continue " + t.values["Radio_ContinueQueueOnTrackEnd"] + ", loop " + t.values["Radio_LoopQueuedTracks"] +
" | volume " + t.values["Radio_Amplitude"]
);
}
function namedId(key: string): string {
const n = NAMED_IDS[key];
return n === undefined ? "???" : qrId(n);
}
export function templateQrCode(t: Template): string {
const pkg = templatePkg(t);
let code = t.kind === "music" ? "~M" + namedId("e:" + t.evt) : "~R";
for (const p of pkg.params) if (!p.queues) code += "," + namedId("p:" + p.name) + qrNum(t.values[p.name] ?? p.def);
code += "," + namedId("p:" + pkg.amp.name) + qrNum(t.values[pkg.amp.name] ?? pkg.amp.def);
if (t.kind === "radio") for (const q of t.queue) code += ";" + q.ch + "." + q.biome + "." + q.track;
return code;
}
function sendPlay(tab: TesterTab, st: TesterState, player: mod.Player): void {
const pkg = current(tab, st);
const e = tab === "radio" ? RADIO_PLAY : pkg.events[st.evt[st.pkg]];
for (const p of pkg.params) if (!p.queues) sendParam(player, st, p);
sendParam(player, st, pkg.amp);
sendEvent(player, st, e.event, e.name, e.key);
st.playing = pkg.name;
}
export function handleTesterAction(tab: TesterTab, st: TesterState, player: mod.Player, action: string, redraw: () => void): boolean {
const pkg = current(tab, st);
const radio = tab === "radio";
if (action === "mtPkgPrev" || action === "mtPkgNext") {
if (radio) return true;
const n = MUSIC_TAB.length;
st.pkg = (st.pkg + (action === "mtPkgNext" ? 1 : n - 1)) % n;
return true;
}
if (action === "mtTarget") {
st.toAll = !st.toAll;
return true;
}
if (action === "mtQueue") {
const q = queueParam(pkg);
if (q === undefined) return false;
ensureLoaded(st, pkg, redraw);
whenLoaded(() => {
sendQueue(player, st, q);
redraw();
});
return true;
}
if (action === "mtPrev" || action === "mtNext") {
if (radio) {
const e = action === "mtNext" ? RADIO_NEXT : RADIO_CLEAR;
if (e === RADIO_NEXT && loaded !== pkg) return true;
ensureLoaded(st, pkg, redraw);
whenLoaded(() => {
sendEvent(player, st, e.event, e.name, e.key);
if (e === RADIO_CLEAR) st.queue = [];
redraw();
});
return true;
}
const n = pkg.events.length;
st.evt[st.pkg] = (st.evt[st.pkg] + (action === "mtNext" ? 1 : n - 1)) % n;
return true;
}
if (action === "mtPlay") {
ensureLoaded(st, pkg, redraw);
whenLoaded(() => {
sendPlay(tab, st, player);
redraw();
});
return true;
}
if (action === "mtStop") {
sendStop(st, player, pkg);
whenLoaded(redraw);
return true;
}
if (action === "mtVolDown" || action === "mtVolUp") {
stepParam(player, st, pkg, pkg.amp, action === "mtVolUp" ? 1 : -1);
return true;
}
const m = /^mtP(\d)(Down|Up)$/.exec(action);
if (m !== null) {
const p = pkg.params[parseInt(m[1], 10)];
if (p === undefined) return false;
stepParam(player, st, pkg, p, m[2] === "Up" ? 1 : -1);
return true;
}
return false;
}
function pickKey(keys: readonly string[], v: number): string {
const k = keys[Math.round(v)];
return k === undefined ? T.logEmpty : k;
}
function radioNote(st: TesterState, ch: number, biome: number): mod.Message {
const q = queueParam(RADIO);
const last = q === undefined ? 0 : maxOf(st, q);
if (ch === 4) return mod.Message(TPL.mtRadioNoteBiome, pickKey(RADIO_BIOMES, biome), last);
return mod.Message(TPL.mtRadioNote, ch, pickKey(RADIO_CHANNELS, ch), last);
}
export function testerFields(tab: TesterTab, st: TesterState): Scope {
const pkg = current(tab, st);
const radio = tab === "radio";
const isLoaded = loaded === pkg;
const evt = pkg.events[st.evt[st.pkg]];
const q = queueParam(pkg);
const ch = radioChannel(st);
const biome = radioBiome(st);
const trackLine = !isLoaded ? TPL.mtTrackUnloaded : loading() ? TPL.mtTrackLoading : TPL.mtTrackOf;
const f: Scope = {
mtTitle: mod.Message(radio ? T.mtCardRadio : T.mtCardTrack),
mtPkgArrows: radio ? "0" : "1",
mtPkg: mod.Message(TPL.mtPackageOf, pkg.key),
mtEvent: mod.Message(radio ? T.mtRadioLine : evt.key),
mtEventIdx: radio ? queueLine(st) : mod.Message(trackLine, st.evt[st.pkg] + 1, pkg.events.length),
mtEventDesc: mod.Message(radio ? (queueIsStale(st) ? T.mtQueueStale : T.mtRadioHelp) : evt.desc),
mtPrevLabel: mod.Message(radio ? T.mtClearQueue : T.mtPrev),
mtPlayLabel: mod.Message(T.mtPlay),
mtStopLabel: mod.Message(T.mtStop),
mtNextLabel: mod.Message(radio ? T.mtNextTrack : T.mtNext),
mtParamNote: radio ? radioNote(st, ch, biome) : mod.Message(pkg.params.length === 0 ? T.mtNoParams : T.mtNoteParams),
mtVol: mod.Message(TPL.num1, st.values[pkg.amp.name]),
mtLast: st.last ?? mod.Message(T.mtNothingSent),
mtTargetLabel: mod.Message(st.toAll ? T.mtTargetAll : T.mtTargetMe),
mtTargetBg: st.toAll ? PALETTE.hot : PALETTE.row,
mtQueueOn: q === undefined ? "0" : "1",
mtQueueLabel: q === undefined ? mod.Message(T.logEmpty) : mod.Message(TPL.mtQueueOf, st.values[q.name]),
};
for (let i = 0; i < PARAM_SLOTS; i++) {
const p = pkg.params[i];
f["mtP" + i + "On"] = p === undefined ? "0" : "1";
f["mtP" + i + "Label"] = p === undefined ? mod.Message(T.logEmpty) : mod.Message(TPL.mtParamLabel, p.key);
f["mtP" + i + "Val"] = p === undefined ? mod.Message(T.logEmpty) : mod.Message(TPL.num1, st.values[p.name]);
f["mtP" + i + "Desc"] = p === undefined ? mod.Message(T.logEmpty) : mod.Message(p.desc);
}
return f;
}
// --- SOURCE: node_modules\bf6-portal-utils\sounds\index.ts ---
export namespace Sounds {
const logging = new Logging('Sounds');
export const LogLevel = Logging.LogLevel;
export function setLogging(
log?: (text: string, error?: unknown) => Promise<void> | void,
logLevel?: Logging.LogLevel,
includeRawError?: boolean
): void {
logging.setLogging(log, logLevel, includeRawError);
}
const DEFAULT_FADE_DURATION: number = 2_000;
const DEFAULT_FADE_STEPS: number = 10;
const DEFAULT_ATTENUATION_RANGE: number = 10;
const _ZERO_VECTOR = mod.CreateVector(0, 0, 0);
export type Target = mod.Player | mod.Squad | mod.Team;
export type FadeOptions = {
startAmplitude: number;
targetAmplitude?: number;
delay?: number;
duration?: number;
steps?: number;
stopOnComplete?: boolean;
};
export type PlayOptions = {
target?: Target;
position?: Vectors.Vector3;
attenuationRange?: number;
duration?: number;
fadeOptions?: Omit<FadeOptions, 'startAmplitude'>;
};
export type PlayOneShotOptions = PlayOptions;
type SFXState = {
stopTimerId?: Timers.TimerID | null;
fadeTimerId?: Timers.TimerID | null;
};
const _states = new Map<number, SFXState>();
function _playSound(
sfx: mod.SFX,
amplitude: number,
position?: Vectors.Vector3,
attenuationRange?: number,
target?: Target
): void {
if (position !== undefined || attenuationRange !== undefined) {
const posVec = position !== undefined ? Vectors.toVector(position) : mod.GetObjectPosition(sfx);
attenuationRange = attenuationRange ?? DEFAULT_ATTENUATION_RANGE;
if (target === undefined) {
mod.PlaySound(sfx, amplitude, posVec, attenuationRange);
} else if (mod.IsType(target, mod.Types.Player)) {
mod.PlaySound(sfx, amplitude, posVec, attenuationRange, target as mod.Player);
} else if (mod.IsType(target, mod.Types.Squad)) {
mod.PlaySound(sfx, amplitude, posVec, attenuationRange, target as mod.Squad);
} else if (mod.IsType(target, mod.Types.Team)) {
mod.PlaySound(sfx, amplitude, posVec, attenuationRange, target as mod.Team);
} else {
logging.log('Target type is invalid', LogLevel.Error);
}
} else {
if (target === undefined) {
mod.PlaySound(sfx, amplitude);
} else if (mod.IsType(target, mod.Types.Player)) {
mod.PlaySound(sfx, amplitude, target as mod.Player);
} else if (mod.IsType(target, mod.Types.Squad)) {
mod.PlaySound(sfx, amplitude, target as mod.Squad);
} else if (mod.IsType(target, mod.Types.Team)) {
mod.PlaySound(sfx, amplitude, target as mod.Team);
} else {
logging.log('Target type is invalid', LogLevel.Error);
}
}
}
function _getOrCreateState(sfxId: number): SFXState {
let state = _states.get(sfxId);
if (!state) {
state = {};
_states.set(sfxId, state);
}
return state;
}
function _cancelStop(sfxId: number): void {
const state = _states.get(sfxId);
if (!state) return;
if (state.stopTimerId != null) {
Timers.clearTimeout(state.stopTimerId);
}
state.stopTimerId = undefined;
if (!state.fadeTimerId) {
_states.delete(sfxId);
}
}
function _cancelFade(sfxId: number): void {
const state = _states.get(sfxId);
if (!state) return;
if (state.fadeTimerId != null) {
Timers.clearInterval(state.fadeTimerId);
}
state.fadeTimerId = undefined;
if (!state.stopTimerId) {
_states.delete(sfxId);
}
}
function _cancelTimers(sfxId: number): void {
const state = _states.get(sfxId);
if (!state) return;
if (state.stopTimerId != null) {
Timers.clearTimeout(state.stopTimerId);
state.stopTimerId = undefined;
}
if (state.fadeTimerId != null) {
Timers.clearInterval(state.fadeTimerId);
state.fadeTimerId = undefined;
}
_states.delete(sfxId);
}
function _fadeInternal(
sfx: mod.SFX,
sfxId: number,
startAmplitude: number,
targetAmplitude: number = 0,
delay: number = 0,
duration: number = DEFAULT_FADE_DURATION,
steps: number = DEFAULT_FADE_STEPS,
stopOnComplete: boolean = targetAmplitude === 0,
disposeOnComplete: boolean = false
): void {
_cancelFade(sfxId);
const stepCount = steps > 0 ? steps : 1;
const stepSize = (startAmplitude - targetAmplitude) / stepCount;
const stepDuration = duration / stepCount;
let currentAmplitude = startAmplitude;
let remainingSteps = stepCount;
const stepFade = () => {
if (!isValid(sfxId)) {
_cancelFade(sfxId);
return;
}
currentAmplitude = Math.max(0, currentAmplitude - stepSize);
mod.SetSoundAmplitude(sfx, currentAmplitude);
--remainingSteps;
if (remainingSteps > 0) return;
_cancelFade(sfxId);
if (logging.willLog(LogLevel.Debug)) {
logging.log(`Sound ${sfxId} completed fade to ${targetAmplitude}`, LogLevel.Debug);
}
if (disposeOnComplete) {
dispose(sfx);
} else if (stopOnComplete) {
stop(sfx);
}
};
const startFade = () => {
const state = _getOrCreateState(sfxId);
if (!isValid(sfxId)) return;
state.fadeTimerId = Timers.setInterval(stepFade, stepDuration);
};
if (delay > 0) {
_getOrCreateState(sfxId).fadeTimerId = Timers.setTimeout(startFade, delay);
} else {
startFade();
}
if (logging.willLog(LogLevel.Info)) {
logging.log(`Sound ${sfxId} fade to ${targetAmplitude} starting in ${delay}ms`, LogLevel.Info);
}
}
function _playInternal(
sfx: mod.SFX,
sfxId: number,
amplitude: number,
target?: Target,
position?: Vectors.Vector3,
attenuationRange?: number,
duration?: number,
fadeOptions?: Omit<FadeOptions, 'startAmplitude'>,
disposeOnComplete: boolean = false
): void {
_playSound(sfx, amplitude, position, attenuationRange, target);
if (duration !== undefined) {
const onStopTimeout = () => {
_cancelStop(sfxId);
if (disposeOnComplete) {
dispose(sfx);
} else {
stop(sfx);
}
};
_getOrCreateState(sfxId).stopTimerId = Timers.setTimeout(onStopTimeout, duration);
}
if (fadeOptions !== undefined) {
_fadeInternal(
sfx,
sfxId,
amplitude,
fadeOptions.targetAmplitude,
fadeOptions.delay,
fadeOptions.duration,
fadeOptions.steps,
fadeOptions.stopOnComplete,
disposeOnComplete
);
}
if (logging.willLog(LogLevel.Info)) {
logging.log(`Sound ${sfxId} played at amplitude ${amplitude.toFixed(2)}`, LogLevel.Info);
}
}
export function create(sfxAsset: mod.RuntimeSpawn_Common, position?: Vectors.Vector3): mod.SFX {
const posVec = position !== undefined ? Vectors.toVector(position) : _ZERO_VECTOR;
const sfx = mod.SpawnObject(sfxAsset, posVec, _ZERO_VECTOR) as mod.SFX;
if (logging.willLog(LogLevel.Debug)) {
logging.log(`Sound ${mod.GetObjId(sfx)} created`, LogLevel.Debug);
}
return sfx;
}
export function play(sfx: mod.SFX, amplitude: number, options?: PlayOptions): void {
const sfxId = mod.GetObjId(sfx);
_cancelTimers(sfxId);
_playInternal(
sfx,
sfxId,
amplitude,
options?.target,
options?.position,
options?.attenuationRange,
options?.duration,
options?.fadeOptions,
false
);
}
export function playOneShot(
sfxAsset: mod.RuntimeSpawn_Common,
duration: number,
amplitude: number,
options?: PlayOneShotOptions
): mod.SFX {
const sfx = create(sfxAsset, options?.position);
_playInternal(
sfx,
mod.GetObjId(sfx),
amplitude,
options?.target,
options?.position,
options?.attenuationRange,
duration,
options?.fadeOptions,
true
);
return sfx;
}
export function stop(sfx: mod.SFX, delay: number = 0): void {
const sfxId = mod.GetObjId(sfx);
_cancelStop(sfxId);
_cancelFade(sfxId);
if (delay > 0) {
const state = _getOrCreateState(sfxId);
state.stopTimerId = Timers.setTimeout(() => {
_cancelStop(sfxId);
if (isValid(sfxId)) {
mod.StopSound(sfx);
}
if (logging.willLog(LogLevel.Info)) {
logging.log(`Sound ${sfxId} stopped`, LogLevel.Info);
}
}, delay);
if (logging.willLog(LogLevel.Info)) {
logging.log(`Sound ${sfxId} scheduled to stop in ${delay}ms`, LogLevel.Info);
}
return;
}
if (isValid(sfxId)) {
mod.StopSound(sfx);
}
if (logging.willLog(LogLevel.Info)) {
logging.log(`Sound ${sfxId} stopped`, LogLevel.Info);
}
}
export function fade(sfx: mod.SFX, options: FadeOptions): void {
const sfxId = mod.GetObjId(sfx);
_fadeInternal(
sfx,
sfxId,
options.startAmplitude,
options.targetAmplitude,
options.delay,
options.duration,
options.steps,
options.stopOnComplete,
false
);
}
export function cancelStop(sfx: mod.SFX): void {
_cancelStop(mod.GetObjId(sfx));
}
export function cancelFade(sfx: mod.SFX): void {
_cancelFade(mod.GetObjId(sfx));
}
export function setAmplitude(sfx: mod.SFX, amplitude: number): void {
const sfxId = mod.GetObjId(sfx);
if (!isValid(sfxId)) return;
mod.SetSoundAmplitude(sfx, amplitude);
if (logging.willLog(LogLevel.Info)) {
logging.log(`Sound ${sfxId} amplitude set to ${amplitude.toFixed(2)}`, LogLevel.Info);
}
}
export function dispose(sfx: mod.SFX): void {
const sfxId = mod.GetObjId(sfx);
_cancelTimers(sfxId);
if (isValid(sfxId)) {
mod.StopSound(sfx);
mod.UnspawnObject(sfx);
}
if (logging.willLog(LogLevel.Debug)) {
logging.log(`Sound ${sfxId} disposed`, LogLevel.Debug);
}
}
export function isValid(sfxId: number): boolean {
return mod.IsValid(mod.GetSFX(sfxId));
}
}
// --- SOURCE: src\uisound.ts ---
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
export function clickSound(action: string): mod.RuntimeSpawn_Common | undefined {
if (action === "mtPlay" || action === "mtSave" || /^r\d+_(play|fav)$/.test(action)) return undefined;
if (action === "btnClose") return UI_SOUND.close;
if (action.slice(0, 3) === "tab") return UI_SOUND.tab;
if (STEPPER.test(action)) return UI_SOUND.step;
return UI_SOUND.click;
}
// --- SOURCE: src\index.ts ---
const ZERO = mod.CreateVector(0, 0, 0);
const ONE = mod.CreateVector(1, 1, 1);
type PreviewState =
| { readonly type: "sfx"; readonly sfx: mod.SFX; readonly key: string }
| { readonly type: "screen"; readonly id: string; readonly key: string };
interface Playing {
readonly sfx: mod.SFX;
timer: Timers.TimerID | null;
}
interface PlayerState {
ui: PlayerUi;
spawned: mod.VFX[];
playing: Playing[];
preview: PreviewState | undefined;
building: boolean;
}
const states: Record<number, PlayerState> = {};
interface ScreenFx {
id: string;
display: string;
category: string;
key: string;
cat: string;
effect: mod.ScreenEffects;
soldier?: mod.SoldierEffects;
}
const SCREEN_FX: ScreenFx[] = [
{ id: "vl7gas", display: "VL7 Gas Mask", category: "Gas", cat: T.catGas, key: T.screenVl7gas, effect: mod.ScreenEffects.VL7, soldier: mod.SoldierEffects.VL7Effect },
{ id: "night", display: "Night Vision", category: "Screen", cat: T.catScreen, key: T.screenNight, effect: mod.ScreenEffects.Night },
{ id: "saturated", display: "Saturated", category: "Screen", cat: T.catScreen, key: T.screenSaturated, effect: mod.ScreenEffects.Saturated },
{ id: "stealth", display: "Stealth", category: "Screen", cat: T.catScreen, key: T.screenStealth, effect: mod.ScreenEffects.Stealth },
];
function labelOf(key: string): string {
return key === "" ? "(none)" : key;
}
Events.OnGameModeStarted.subscribe(() => {
initLog();
log(
`game mode started: ${SFX_CATALOG.length} sfx, ${VFX_CATALOG.length} vfx, ` +
`${SFX_PREFIXES.length + VFX_PREFIXES.length} prefixes, ` +
`${SCREEN_FX.length} player-wide, menu starts closed`
);
const screenRows: ScreenRow[] = [];
for (const f of SCREEN_FX) {
screenRows.push({ type: "screen", id: f.id, display: f.display, category: f.category, key: f.key, catKey: f.cat });
}
registerGroups(
SFX_CATEGORIES as unknown as string[],
VFX_CATEGORIES as unknown as string[],
screenRows
);
mod.SetSpawnMode(mod.SpawnModes.AutoSpawn);
loadStartupMusic();
});
Events.OnPlayerDeployed.subscribe((player: mod.Player) => {
mod.AddEquipment(player, mod.Gadgets.Misc_PortalGadget);
ensure(player);
log(`deploy: player ${mod.GetObjId(player)} granted the portal gadget`);
});
Events.OnPlayerLeaveGame.subscribe((playerId: number) => {
const st = states[playerId];
if (st === undefined) return;
clearAll(st);
destroyUI(st.ui);
delete states[playerId];
});
function ensure(player: mod.Player): PlayerState {
const pid = mod.GetObjId(player);
const existing = states[pid];
if (existing !== undefined) return existing;
const ui: PlayerUi = {
player: player,
pid: pid,
tab: "sfx",
open: false,
group: 0,
railPage: 0,
page: 0,
selectedKey: "",
armedKey: "",
favourites: [],
scale: CONFIG.defaultScale,
amp: CONFIG.defaultAmplitude,
rng: CONFIG.defaultRange,
query: "",
searchOpen: false,
kbPage: 0,
fDim: "",
fKind: "",
fVfx: "",
spawnedCount: 0,
root: undefined,
nodes: {},
keyAct: [],
pfxAct: [],
rowKeys: [],
chipAct: [],
tester: newTesterState(),
qrOpen: false,
qrParts: [],
qrPart: 0,
qr: undefined,
qrShown: -1,
};
const st: PlayerState = { ui: ui, spawned: [], playing: [], preview: undefined, building: false };
states[pid] = st;
renderLogged(st);
return st;
}
function redraw(st: PlayerState): void {
renderLogged(st);
}
function renderLogged(st: PlayerState): void {
const ui = st.ui;
log(`render begin: open=${ui.open} tab=${ui.tab}`);
const r = renderBatch(ui, st.spawned.length, CONFIG.widgetsPerBatch);
log(`render end: open=${ui.open} created=${r.created} complete=${r.complete}`);
if (r.complete || st.building) return;
st.building = true;
Timers.setTimeout(() => {
st.building = false;
if (states[ui.pid] === st) redraw(st);
}, CONFIG.widgetBatchDelayMs);
}
function defer(st: PlayerState): void {
Timers.setTimeout(() => redraw(st), 0);
}
setActionHandler((ui, action) => {
const st = states[mod.GetObjId(ui.player)];
if (st !== undefined) handle(st, action);
});
function setOpen(ui: PlayerUi, open: boolean): void {
if (ui.open === open) return;
ui.open = open;
if (!open) ui.qrOpen = false;
log(`menu ${open ? "opened" : "closed"}`);
}
function handle(st: PlayerState, action: string): void {
const ui = st.ui;
log(
`button: ${action} | open=${ui.open} tab=${ui.tab} group=${ui.group} page=${ui.page} ` +
`query="${ui.query}" kbPage=${ui.kbPage} search=${ui.searchOpen} ` +
`selected=${labelOf(ui.selectedKey)} armed=${labelOf(ui.armedKey)} ` +
`dim=${ui.fDim} kind=${ui.fKind} vfx=${ui.fVfx} amp=${ui.amp} rng=${ui.rng} scale=${ui.scale}`
);
if (action === "mtSave" && isTesterTab(ui.tab)) {
const r = saveTemplate(ui.tab, ui.tester);
if (r.added) ui.favourites.push(templateKey(r.tpl));
playUiSound(ui.player, UI_SOUND.on);
defer(st);
return;
}
const sound = clickSound(action);
if (sound !== undefined) playUiSound(ui.player, sound);
if (action === "btnClose") {
setOpen(ui, false);
defer(st);
return;
}
if (action === "tabSfx" || action === "tabVfx" || action === "tabFav" || action === "tabMusic" || action === "tabRadio") {
ui.tab = action === "tabSfx" ? "sfx" : action === "tabVfx" ? "vfx" : action === "tabFav" ? "fav" : action === "tabMusic" ? "music" : "radio";
ui.qrOpen = false;
ui.group = 0;
ui.railPage = 0;
ui.page = 0;
ui.selectedKey = "";
defer(st);
return;
}
if (action.slice(0, 2) === "mt") {
if (isTesterTab(ui.tab) && handleTesterAction(ui.tab, ui.tester, ui.player, action, () => defer(st))) {
defer(st);
return;
}
log(`UNHANDLED ACTION "${action}" (open=${ui.open} tab=${ui.tab})`);
return;
}
if (action === "btnSearch") {
ui.searchOpen = !ui.searchOpen;
defer(st);
return;
}
if (action.length === 2 || action.length === 3) {
const F = action[0] === "f";
if (F && action.charAt(1) !== undefined) {
const on = action;
if (on === "fa") {
ui.fDim = "";
ui.fKind = "";
ui.fVfx = "";
} else if (on === "fd3") ui.fDim = ui.fDim === "3d" ? "" : "3d";
else if (on === "fd2") ui.fDim = ui.fDim === "2d" ? "" : "2d";
else if (on === "fl") ui.fKind = ui.fKind === "loop" ? "" : "loop";
else if (on === "fo") ui.fKind = ui.fKind === "oneshot" ? "" : "oneshot";
else if (on === "fw") ui.fVfx = ui.fVfx === "world" ? "" : "world";
else if (on === "fp") ui.fVfx = ui.fVfx === "screen" ? "" : "screen";
else return;
ui.page = 0;
defer(st);
return;
}
}
if (action.slice(0, 4) === "key_") {
if (ui.query.length >= MAX_QUERY) return;
ui.query += action.slice(4);
ui.page = 0;
defer(st);
return;
}
if (action === "page") {
ui.kbPage = ui.kbPage === 1 ? 0 : 1;
defer(st);
return;
}
if (action.slice(0, 4) === "pfx_") {
const token = action.slice(4);
if (ui.query.length < MAX_QUERY) ui.query += token;
ui.kbPage = 0;
ui.page = 0;
defer(st);
return;
}
if (action === "spc") {
if (ui.query.length < MAX_QUERY) ui.query += " ";
ui.page = 0;
defer(st);
return;
}
if (action === "bksp") {
ui.query = ui.query.slice(0, ui.query.length - 1);
ui.page = 0;
defer(st);
return;
}
if (action === "clr") {
ui.query = "";
ui.page = 0;
defer(st);
return;
}
if (action === "done") {
ui.searchOpen = false;
defer(st);
return;
}
if (action === "btnPrev") {
ui.page = Math.max(0, ui.page - 1);
defer(st);
return;
}
if (action === "btnNext") {
ui.page = Math.min(pageCount(listFor(ui.tab, ui.group, filtersOf(ui)).length) - 1, ui.page + 1);
defer(st);
return;
}
if (action === "btnAmpDown") {
ui.amp = Math.max(CONFIG.minAmplitude, ui.amp - CONFIG.amplitudeStep);
defer(st);
return;
}
if (action === "btnAmpUp") {
ui.amp = Math.min(CONFIG.maxAmplitude, ui.amp + CONFIG.amplitudeStep);
defer(st);
return;
}
if (action === "btnRngDown") {
ui.rng = Math.max(CONFIG.minRange, ui.rng - CONFIG.rangeStep);
defer(st);
return;
}
if (action === "btnRngUp") {
ui.rng = Math.min(CONFIG.maxRange, ui.rng + CONFIG.rangeStep);
defer(st);
return;
}
if (action === "btnScaleDown") {
ui.scale = Math.max(CONFIG.minScale, round2_2(ui.scale - CONFIG.scaleStep));
defer(st);
return;
}
if (action === "btnScaleUp") {
ui.scale = Math.min(CONFIG.maxScale, round2_2(ui.scale + CONFIG.scaleStep));
defer(st);
return;
}
if (action === "btnStopAll") {
stopAll(st);
defer(st);
return;
}
if (action === "btnUndo") {
undoLast(st);
defer(st);
return;
}
if (action === "btnDeleteAll") {
clearAll(st);
defer(st);
return;
}
if (action === "btnSelect") {
if (ui.tab === "fav") {
exportFavourites(st);
return;
}
armSelected(st);
return;
}
if (action === "btnQr") {
if (ui.tab !== "fav" || ui.favourites.length === 0) return;
const site: string = CONFIG.qrSite;
ui.qrParts = packQrPayloads(favouriteQrCodes(st), site === "" ? "" : site + "#");
ui.qrPart = 0;
ui.qrOpen = ui.qrParts.length > 0;
logQrText(ui);
defer(st);
return;
}
if (action === "btnQrPrev" || action === "btnQrNext") {
const next = ui.qrPart + (action === "btnQrNext" ? 1 : -1);
if (!ui.qrOpen || next < 0 || next >= ui.qrParts.length) return;
ui.qrPart = next;
logQrText(ui);
defer(st);
return;
}
if (action === "btnQrClose") {
ui.qrOpen = false;
defer(st);
return;
}
if (action === "btnDebug") {
setDebug(debugEnabled() === false);
defer(st);
return;
}
if (action.slice(0, 4) === "rail" || (action.charAt(0) === "c" && action.length > 1)) {
const body = action.slice(0, 4) === "rail" ? action.slice(4) : action.slice(1);
const group = parseInt(body, 10);
if (isNaN(group) || group < 0) return;
ui.group = group;
ui.page = 0;
defer(st);
return;
}
if (action === "btnRailPrev") {
ui.railPage = Math.max(0, ui.railPage - 1);
defer(st);
return;
}
if (action === "btnRailNext") {
ui.railPage = ui.railPage + 1;
defer(st);
return;
}
if (action.charAt(0) === "r") {
const us = action.indexOf("_");
if (us < 2) return;
const idx = parseInt(action.slice(1, us), 10);
if (isNaN(idx)) return;
const tag = action.slice(us + 1);
const page = pageSlice(visibleList(ui), ui.page);
const item = page[idx];
if (item === undefined) return;
const key = rowKey(item);
if (item.type === "tpl") {
const t = item.tpl;
if (tag === "sel") {
ui.tab = applyTemplate(ui.tester, t);
ui.selectedKey = "";
defer(st);
return;
}
if (tag === "play") {
playTemplate(ui.tester, ui.player, t, () => defer(st));
defer(st);
return;
}
if (tag === "stop") {
stopTemplate(ui.tester, ui.player, t);
defer(st);
return;
}
if (tag === "fav") {
ui.favourites.splice(ui.favourites.indexOf(key), 1);
removeTemplate(ui.tester, key);
playUiSound(ui.player, UI_SOUND.off);
defer(st);
return;
}
}
if (tag === "sel") {
ui.selectedKey = key;
ui.armedKey = key;
defer(st);
return;
}
if (tag === "fav") {
const at = ui.favourites.indexOf(key);
if (at >= 0) ui.favourites.splice(at, 1);
else ui.favourites.push(key);
playUiSound(ui.player, at >= 0 ? UI_SOUND.off : UI_SOUND.on);
defer(st);
return;
}
if (tag === "stop") {
if (st.preview !== undefined && st.preview.key === key) stopPreview(st);
defer(st);
return;
}
if (tag === "play") {
ui.selectedKey = key;
preview(st, item);
defer(st);
return;
}
}
log(`UNHANDLED ACTION "${action}" (open=${ui.open} tab=${ui.tab})`);
}
function round2_2(v: number): number {
return Math.round(v * 100) / 100;
}
function armSelected(st: PlayerState): void {
const ui = st.ui;
if (ui.selectedKey === "") {
mod.DisplayHighlightedWorldLogMessage(mod.Message(T.pickFirst), ui.player);
return;
}
ui.armedKey = ui.selectedKey;
setOpen(ui, false);
defer(st);
}
function spawnSfx(st: PlayerState, entry: SfxEntry, at: mod.Vector, onlyMe: boolean): mod.SFX {
const sfx = mod.SpawnObject(entry.asset, at, ZERO, ONE) as mod.SFX;
if (entry.dim === "2d") mod.PlaySound(sfx, st.ui.amp, st.ui.player);
else if (onlyMe) mod.PlaySound(sfx, st.ui.amp, at, st.ui.rng, st.ui.player);
else mod.PlaySound(sfx, st.ui.amp, at, st.ui.rng);
track(st, sfx, entry.windowMs);
return sfx;
}
function track(st: PlayerState, sfx: mod.SFX, windowMs: number): void {
const p: Playing = { sfx: sfx, timer: null };
p.timer = Timers.setTimeout(() => {
p.timer = null;
untrack(st, sfx);
}, windowMs);
st.playing.push(p);
if (st.playing.length > CONFIG.maxSoundsPerPlayer) {
const oldest = st.playing[0];
untrack(st, oldest.sfx);
}
}
function untrack(st: PlayerState, sfx: mod.SFX): void {
let i = -1;
for (let k = 0; k < st.playing.length; k++) if (st.playing[k].sfx === sfx) i = k;
if (i < 0) return;
const p = st.playing[i];
st.playing.splice(i, 1);
if (p.timer !== null) Timers.clear(p.timer);
mod.StopSound(sfx);
mod.UnspawnObject(sfx);
}
function stopPreview(st: PlayerState): void {
const p = st.preview;
if (p === undefined) return;
st.preview = undefined;
if (p.type === "screen") {
const f = findScreenFx(p.id);
if (f !== undefined) setScreenFx(st, f, false);
} else if (p.type === "sfx") {
untrack(st, p.sfx);
}
}
function preview(st: PlayerState, r: Row): void {
stopPreview(st);
if (r.type === "sfx") {
const sfx = spawnSfx(st, r.entry, eyeFront(st), true);
st.preview = { type: "sfx", sfx: sfx, key: rowKey(r) };
return;
}
if (r.type === "screen") {
const f = findScreenFx(r.id);
if (f === undefined) return;
const on = !isScreenOn(st, f);
setScreenFx(st, f, on);
st.preview = on ? { type: "screen", id: r.id, key: rowKey(r) } : undefined;
mod.DisplayHighlightedWorldLogMessage(mod.Message(TPL.screenToggle, r.key, on ? T.onWord : T.offWord), st.ui.player);
return;
}
spawnVfx(st, r, eyeFront(st));
}
function findScreenFx(id: string): ScreenFx | undefined {
for (const f of SCREEN_FX) if (f.id === id) return f;
return undefined;
}
const activeScreenFx: Record<string, boolean> = {};
function fxKey(st: PlayerState, f: ScreenFx): string {
return st.ui.pid + "/" + f.id;
}
function isScreenOn(st: PlayerState, f: ScreenFx): boolean {
return activeScreenFx[fxKey(st, f)] === true;
}
function setScreenFx(st: PlayerState, f: ScreenFx, on: boolean): void {
mod.EnableScreenEffect(st.ui.player, f.effect, on);
if (f.soldier !== undefined) mod.SetSoldierEffect(st.ui.player, f.soldier, on);
const key = fxKey(st, f);
if (on) activeScreenFx[key] = true;
else delete activeScreenFx[key];
}
function eyeFront(st: PlayerState): mod.Vector {
const p = st.ui.player;
const facing = mod.Normalize(mod.GetSoldierState(p, mod.SoldierStateVector.GetFacingDirection));
return mod.Add(mod.GetSoldierState(p, mod.SoldierStateVector.EyePosition), mod.Multiply(facing, 3));
}
function spawnVfx(st: PlayerState, r: Row, at: mod.Vector): void {
if (r.type !== "spawn") return;
const vfx = mod.SpawnObject(r.entry.asset, at, ZERO, ONE) as mod.VFX;
mod.EnableVFX(vfx, true);
mod.SetVFXScale(vfx, st.ui.scale);
mod.SetVFXColor(vfx, mod.CreateVector(CONFIG.vfxColor[0], CONFIG.vfxColor[1], CONFIG.vfxColor[2]));
st.spawned.push(vfx);
if (st.spawned.length > CONFIG.maxSpawnedPerPlayer) {
const oldest = st.spawned.shift();
if (oldest !== undefined) mod.UnspawnObject(oldest);
}
}
function undoLast(st: PlayerState): void {
const v = st.spawned.pop();
if (v === undefined) {
mod.DisplayHighlightedWorldLogMessage(mod.Message(T.nothingToUndo), st.ui.player);
return;
}
mod.EnableVFX(v, false);
mod.UnspawnObject(v);
}
function exportFavourites(st: PlayerState): void {
const ui = st.ui;
if (ui.favourites.length === 0) {
logAlways("FAVOURITES: nothing to export");
return;
}
logAlways("---- FAVOURITES (" + ui.favourites.length + ") ----");
for (const key of ui.favourites) {
const r = findRow(key);
if (r === undefined) continue;
if (r.type === "sfx") logAlways(rowRawName(r) + " | " + rowCategory(r) + " | SFX | " + soundLength(r.entry));
else logAlways(rowRawName(r) + " | " + rowCategory(r) + " | VFX");
}
for (const key of ui.favourites) {
const t = key.startsWith("tpl") ? findTemplate(ui.tester, key) : undefined;
if (t !== undefined) logAlways(templateExportLine(t));
}
logAlways("---- END FAVOURITES ----");
mod.DisplayHighlightedWorldLogMessage(mod.Message(TPL.exportedN, ui.favourites.length), ui.player);
}
function soundLength(e: SfxEntry): string {
if (e.kind === "loop") return "LOOP";
return e.lengthText !== "" ? e.lengthText : "?";
}
function favouriteQrCodes(st: PlayerState): string[] {
const ui = st.ui;
const codes: string[] = [];
const add = (name: string, code: string) => {
log("QR MAP " + name + " -> " + code);
codes.push(code);
};
for (const key of ui.favourites) {
const r = findRow(key);
if (r === undefined) continue;
const n = r.type === "sfx" ? runId(SFX_ID_RUNS, SFX_CATALOG.indexOf(r.entry)) : r.type === "spawn" ? runId(VFX_ID_RUNS, VFX_CATALOG.indexOf(r.entry)) : NAMED_IDS[key];
if (n !== undefined) add(rowRawName(r), qrId(n));
}
for (const key of ui.favourites) {
const t = key.startsWith("tpl") ? findTemplate(ui.tester, key) : undefined;
if (t !== undefined) add(templateExportLine(t), templateQrCode(t));
}
return codes;
}
function logQrText(ui: PlayerUi): void {
const text = ui.qrParts[ui.qrPart];
if (text !== undefined) log(`QR TEXT ${ui.qrPart + 1}/${ui.qrParts.length}: ${JSON.stringify(text)}`);
}
function stopAll(st: PlayerState): void {
const n = st.playing.length;
while (st.playing.length > 0) untrack(st, st.playing[0].sfx);
log(`stop all: silenced ${n} sound(s)`);
mod.DisplayHighlightedWorldLogMessage(mod.Message(TPL.stoppedN, n), st.ui.player);
}
function clearAll(st: PlayerState): void {
for (const v of st.spawned) {
mod.EnableVFX(v, false);
mod.UnspawnObject(v);
}
st.spawned.length = 0;
for (const f of SCREEN_FX) setScreenFx(st, f, false);
}
Events.OnPortalGadgetAimStart.subscribe((player: mod.Player) => {
const st = ensure(player);
if (st.ui.open) return;
setOpen(st.ui, true);
playUiSound(player, UI_SOUND.open);
defer(st);
log(`gadget aim: opening menu, tab=${st.ui.tab}`);
});
Events.OnPortalGadgetFireStart.subscribe((player: mod.Player) => {
const st = ensure(player);
if (st.ui.armedKey === "") {
mod.DisplayHighlightedWorldLogMessage(mod.Message(T.armFirst), player);
log("gadget fire: nothing armed (menu not opened)");
return;
}
const facing = mod.Normalize(mod.GetSoldierState(player, mod.SoldierStateVector.GetFacingDirection));
const start = mod.Add(mod.GetSoldierState(player, mod.SoldierStateVector.EyePosition), facing);
setOpen(st.ui, false);
defer(st);
log(`gadget fire: armed=${st.ui.armedKey} tab=${st.ui.tab} scale=${st.ui.scale}`);
mod.RayCast(player, start, mod.Add(start, mod.Multiply(facing, CONFIG.rayLength)));
});
Events.OnRayCastHit.subscribe((player: mod.Player, point: mod.Vector, _normal: mod.Vector) => {
const st = states[mod.GetObjId(player)];
if (st === undefined) return;
const armed = findRow(st.ui.armedKey);
if (armed === undefined || armed.type === "tpl") return;
if (armed.type === "sfx") {
spawnSfx(st, armed.entry, point, false);
} else if (armed.type === "spawn") {
spawnVfx(st, armed, point);
} else {
const f = findScreenFx(armed.id);
if (f !== undefined) setScreenFx(st, f, !isScreenOn(st, f));
}
st.ui.spawnedCount = st.spawned.length;
defer(st);
log(`raycast hit: placed ${armed.type} ${armed.type === "screen" ? armed.id : armed.entry.name}, world total=${st.spawned.length}`);
});
Events.OnRayCastMissed.subscribe((player: mod.Player) => {
mod.DisplayHighlightedWorldLogMessage(mod.Message(T.noSurface), player);
});
