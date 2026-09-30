-- Example integration. Copy this folder into your resources (outside cortex-minigames), then:
--   ensure cortex-minigames
--   ensure cortex-minigames-demo
fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'cortex-minigames-demo'
description 'Working examples for cortex-minigames: checks, QTEs, sequences and a server-issued attempt'
version '1.0.0'

dependency 'cortex-minigames'

client_scripts {
    '@cortex-minigames/caller.lua', -- watchdog helper: always returns a result
    'client.lua',
}

server_scripts {
    'server.lua',
}
