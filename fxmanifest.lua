fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'cortex-minigames'
author 'GSDMODS/CORTEX'
description 'Reusable skill checks, QTEs and minigames for Cortex resources'
version '1.1.0'
-- Releases are published here; server/version_check.lua reports newer ones on start.
cortex_update_repo 'IEver3st/cortex-minigames'

-- cortex-lib is optional: preferences appear in Cortex Settings when started. client/cortex.lua
-- loads its readable presentation-client.lua on demand; no missing @ import on standalone servers.

shared_scripts {
    'config.lua',
    'shared/log.lua',
    'shared/locale.lua',
    'locales/en.lua',
    'shared/schema.lua',
}

client_scripts {
    'client/prefs.lua',
    'client/cortex.lua',
    'client/input.lua',
    'client/context.lua',
    'client/session.lua',
    'client/sequence.lua',
    'client/api.lua',
    'client/attempts.lua',
    'client/commands.lua',
}

server_scripts {
    'server/attempts.lua',
    'server/commands.lua',
    'server/version_check.lua',
}

ui_page 'web/dist/index.html'

files {
    'shared/catalog.json',
    'caller.lua',
    'web/dist/index.html',
    'web/dist/assets/*',
}

-- Configuration, locales, caller helper and examples stay readable. The free public package uses
-- plaintext Lua; these entries also preserve editability if an escrow package is built later.
escrow_ignore {
    'config.lua',
    'locales/*.lua',
    'caller.lua',
    'examples/**',
}
