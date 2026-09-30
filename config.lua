-- Operator configuration. These bounds are applied after game defaults, presets and caller
-- overrides, so a caller can never exceed them.

Config = {}

Config.Locale = 'en'

-- Structured logs are off by default. When on they are bounded and rate limited per event.
Config.Debug = false

Config.Bounds = {
    minTimeoutMs = 1000,
    maxTimeoutMs = 180000,
    maxFeedbackMs = 1500,
    maxSequenceSteps = 8,
    maxStepRetries = 3,
    maxSequenceDeadlineMs = 600000,
    -- Leave empty to allow every catalog game, or list ids to restrict callers, e.g. { timing = true }.
    allowedGames = {},
}

Config.Session = {
    startupTimeoutMs = 6000,   -- NUI must acknowledge `open` within this, or the attempt errors
    practiceTimeoutMs = 30000, -- first-use practice card waits this long for the player
    hardGraceMs = 1500,        -- Lua deadline = gameplay timeout + this grace
    contextIntervalMs = 250,   -- death, radius, entity and caller checks while active
    stepGapMs = 250,           -- pause between sequence steps, after the result feedback
    defaultFeedbackMs = 650,
}

-- Controller mapping (control group 2, frontend). Owners can adjust if a pad reports differently.
Config.Pad = {
    buttons = {
        { control = 172, action = 'up' },
        { control = 173, action = 'down' },
        { control = 174, action = 'left' },
        { control = 175, action = 'right' },
        { control = 201, action = 'primary' }, -- A
        { control = 203, action = 'alt' },     -- X
        { control = 204, action = 'rotate' },  -- Y
        { control = 205, action = 'prev' },    -- LB
        { control = 206, action = 'next' },    -- RB
        { control = 202, action = 'cancel' },  -- B
    },
    axes = { lx = 218, ly = 219, rt = 229 },
    deadzone = 0.2,
    axisEpsilon = 0.02,
}

-- Client events that end the character session. Any of these cancels an active minigame.
Config.LogoutEvents = {
    'QBCore:Client:OnPlayerUnload',
    'qbx_core:client:playerLoggedOut',
}

Config.Server = {
    maxActivePerPlayer = 1,
    maxActiveTotal = 256,
    maxActivePerOwner = 128,
    -- Extra time the client may take beyond the spec's own budget before an attempt expires.
    expirySlackMs = 45000,
    -- Completion/ack events per player per second before the rest are dropped.
    eventRate = 6,
    -- Client-reported duration may exceed server-measured time by at most this much.
    durationSlackMs = 1500,
}

-- `/mgprefs` lets players change volume, motion, scale and keys without cortex-lib.
Config.PreferenceCommand = 'mgprefs'

-- Development commands stay unregistered unless the server sets `setr cortex_minigames_dev 1`.
Config.DevConvar = 'cortex_minigames_dev'
