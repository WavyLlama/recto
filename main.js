// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=9';
import { initSync } from './sync.js?v=9';
import './header.js?v=9';
import './home.js?v=9';
import './deck.js?v=9';
import './study.js?v=9';
import './me.js?v=9';
import './social.js?v=9';
import './admin.js?v=9';
import './ai.js?v=9';

route();
initSync();
