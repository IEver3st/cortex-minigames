fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'cortex-minigames'
author 'Cortex'
description 'Reusable skill checks, QTEs and minigames for Cortex resources'
version '1.0.0'

-- cortex-lib is optional: when started, preferences appear in Cortex Settings.
-- Nothing here loads @cortex-lib/init.lua, so this resource also runs without it.

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
}

ui_page 'web/dist/index.html'

files {
    'shared/catalog.json',
    'caller.lua',
    'web/dist/index.html',
    'web/dist/assets/*',
}
