// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=7';
import { initSync } from './sync.js?v=7';
import './header.js?v=7';
import './home.js?v=7';
import './deck.js?v=7';
import './study.js?v=7';
import './me.js?v=7';
import './social.js?v=7';
import './admin.js?v=7';
import './ai.js?v=7';

route();
initSync();
