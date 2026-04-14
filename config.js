// config.js
// Set to 'dev' to show Debug Logs and hide the GitHub badge.
// Set to 'prod' to hide Debug Logs and show the GitHub badge.
export const CONFIG = {
    ENV: 'prod'
};

if (typeof window !== 'undefined') window.CONFIG = CONFIG;

