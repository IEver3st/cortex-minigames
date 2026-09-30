-- English. Copy this file to add a language, change the code, list it in fxmanifest.lua and set
-- Config.Locale. `ui` keys override the built-in English UI; omit a key to keep the default.

CortexMinigames = CortexMinigames or {}
CortexMinigames.Locales = CortexMinigames.Locales or {}

CortexMinigames.Locales.en = {
    keys = {
        ['repair.breaker'] = 'Reset the breaker',
        ['repair.breaker.hint'] = 'Stop inside the lit window.',
        ['lock.door'] = 'Pick the lock',
        ['radio.tune'] = 'Tune the receiver',
    },
    ui = {
        -- Examples of available keys (English defaults live in the UI):
        -- ['headline.success'] = 'Clear',
        -- ['reason.tool_broke'] = 'The tool snapped',
        -- ['ui.ready'] = 'Ready',
        -- ['ui.howItWorks'] = 'How it works',
        -- ['ui.pressToStart'] = 'to start',
        -- ['ui.cancel'] = 'Cancel',
        -- ['game.timing.name'] = 'Timing Check',
        -- ['game.timing.tutorial'] = '...',
        -- ['hint.Stop'] = 'Stop',
    },
}
